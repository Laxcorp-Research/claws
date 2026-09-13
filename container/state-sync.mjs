// Shared runtime-state sync - single source of truth for bundling the OpenClaw
// data dir and uploading it to the Claws control plane.
//
// Imported by BOTH:
//   - container/process-manager.mjs  (image: /usr/local/bin/process-manager.mjs
//     → `./state-sync.mjs`) - the periodic 5-min interval + SIGTERM final sync.
//   - container/claws-activity-reporter/index.mjs (image:
//     /opt/claws-activity-reporter/index.mjs → `../state-sync.mjs`) - the
//     on-demand POST /internal/sync-now route (backend-triggered pre-destroy
//     sync for Stop/hibernate).
// The Dockerfile copies THIS one source file to /usr/local/bin/state-sync.mjs
// AND /opt/state-sync.mjs so both importers resolve a clean relative path.
//
// ── ACCEPTED CROSS-PROCESS RACE (read before "fixing" the in-flight guard) ──
// process-manager runs in the container PARENT process; the reporter plugin
// (and thus the /internal/sync-now route) runs in the gateway CHILD process.
// `inFlight` below is therefore PER-PROCESS: it coalesces concurrent callers
// WITHIN one process (e.g. two backend retries hitting the route), but it does
// NOT coordinate the route's sync against process-manager's 5-min interval in
// the other process. That residual race is ACCEPTED AS BENIGN, and stays benign
// only because of one invariant:
//   INVARIANT: /api/internal/state/finalize writes the snapshot with a SINGLE
//   atomic `updateMany` (one-shot column write) - never a read-modify-write.
//   (Legacy /upload is reject-only 413 USE_BLOB.)
// Given that invariant: concurrent uploads can't tear or partially-overwrite
// the row; the worst case is an equal-or-fresher snapshot (last writer wins,
// both bundles captured seconds apart). And on the Stop/hibernate path the
// container is deleted right after sync-now's confirmed 200, so the interval
// stops - there is no later writer to stale-overwrite what sync-now persisted.
// sync-now's 200 (count>=1) is the guarantee: "state as of Stop is persisted."
// (A regression test locks the atomic-upload invariant; if anyone refactors the
// upload into a read-modify-write, that test fails.)
//
// ── BLOB TRANSPORT (D2 / PR-1) - sole sync path ──
//   1) POST /state/blob-token → clientToken
//   2) PUT gzip bytes to Vercel Blob API (bypasses edge body cap)
//   3) POST /state/finalize { blobUrl, sha256, sizes } - platform verifies hash
//      then atomic updateMany (+ idempotent noop + best-effort blob del).
// Legacy /state/upload is reject-only (413 USE_BLOB) for old images.

import fs from "fs"
import path from "path"
import zlib from "zlib"
import crypto from "crypto"

export const OPENCLAW_DATA_DIR = "/home/node/.openclaw"
const UPLOAD_TIMEOUT_MS = 30_000
const BLOB_PUT_TIMEOUT_MS = 120_000

// Must stay in lockstep with src/lib/openclaw/state-sync-limits.ts
export const SOFT_TARGET_COMPRESSED_BYTES = 50 * 1024 * 1024
export const ABSOLUTE_MAX_COMPRESSED_BYTES = 80 * 1024 * 1024
export const NEAR_CAP_WARN_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.8)
export const NEAR_CAP_REARM_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.7)

const UUID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

// Config files are re-delivered via env vars at every boot (deriveContainerEnv),
// so they are NOT runtime state. Logs/caches/media/exec-approvals are
// non-session bulk: exclude from the snapshot (9.4 history lives in sqlite).
const CONFIG_FILES = new Set(["openclaw.json", ".env", "cron"])
const BULK_TOP_LEVEL = new Set([
  "logs",
  "log",
  "cache",
  "caches",
  "tmp",
  "temp",
  "media",
  "downloads",
  "browser",
  "chromium",
  "node_modules",
  "exec-approvals.json",
  "exec-approvals.sock",
])
const BULK_SEGMENTS = new Set(["logs", "log", "cache", "caches"])

export function isRuntimeFile(relativePath) {
  const parts = relativePath.split("/")
  const topLevel = parts[0]
  if (CONFIG_FILES.has(topLevel)) return false
  if (BULK_TOP_LEVEL.has(topLevel)) return false
  if (topLevel.startsWith("exec-approvals")) return false
  if (topLevel.startsWith(".") && topLevel !== ".openclaw") return false
  if (parts.some((p) => BULK_SEGMENTS.has(p))) return false
  if (parts.some((p) => p.endsWith(".log"))) return false
  return true
}

const ESSENTIAL_MD = /^(MEMORY|USER|SOUL|AGENTS|IDENTITY|HEARTBEAT|BOOT|TOOLS)\.md$/

export function isEssentialSyncFile(relativePath) {
  if (relativePath.endsWith("openclaw-agent.sqlite")) return true
  if (relativePath.startsWith("shared/")) return true
  const base = relativePath.split("/").pop() || ""
  return ESSENTIAL_MD.test(base)
}

function gzipBundle(bundle, gzipSync) {
  return gzipSync(Buffer.from(JSON.stringify(bundle)))
}

function pickFiles(files, pred) {
  /** @type {Record<string, string>} */
  const next = {}
  const dropped = []
  for (const [key, value] of Object.entries(files)) {
    if (pred(key)) next[key] = value
    else dropped.push(key)
  }
  return { files: next, dropped }
}

/**
 * Size-aware policy: over soft target, drop non-essential; over hard cap,
 * keep sqlite + MEMORY/workspace md + shared. Always returns a bundle to
 * upload (never silent refuse). Caller still PUTs even if still over hard.
 */
export function applySizeAwareBundle(bundle, opts = {}) {
  const gzipSync = opts.gzipSync ?? zlib.gzipSync
  const soft = opts.softBytes ?? SOFT_TARGET_COMPRESSED_BYTES
  const hard = opts.hardBytes ?? ABSOLUTE_MAX_COMPRESSED_BYTES
  let files = { ...bundle.files }
  const dropped = []
  let warning = null
  const asBundle = (nextFiles) => ({ files: nextFiles, totalSize: bundle.totalSize ?? 0 })
  const measure = (nextFiles) => gzipBundle(asBundle(nextFiles), gzipSync).length

  if (measure(files) > soft) {
    const trimmed = pickFiles(
      files,
      (key) => isEssentialSyncFile(key) || key.endsWith(".sqlite"),
    )
    if (Object.keys(trimmed.files).length > 0 && trimmed.dropped.length > 0) {
      files = trimmed.files
      dropped.push(...trimmed.dropped)
      warning = "trimmed-nonessential"
    }
  }

  if (measure(files) > hard) {
    const essential = pickFiles(files, (key) => isEssentialSyncFile(key))
    if (Object.keys(essential.files).length > 0 && essential.dropped.length > 0) {
      files = essential.files
      dropped.push(...essential.dropped)
      warning = "trimmed-essential-only"
    }
  }

  const outBundle = asBundle(files)
  const compressed = gzipBundle(outBundle, gzipSync)
  return {
    bundle: outBundle,
    compressed,
    dropped,
    warning,
    stillOverHard: compressed.length > hard,
  }
}

/**
 * Parse live session UUIDs from an agent's sessions.json.
 * Returns null when the index is missing/unreadable → caller fail-opens
 * (ships everything for that agent rather than silently dropping live data).
 */
export function loadLiveSessionIds(sessionsDir) {
  const indexPath = path.join(sessionsDir, "sessions.json")
  if (!fs.existsSync(indexPath)) return null
  try {
    const raw = fs.readFileSync(indexPath, "utf8")
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null
    const ids = new Set()
    for (const v of Object.values(obj)) {
      if (typeof v === "string") {
        ids.add(v.replace(/\.jsonl$/i, ""))
      } else if (v && typeof v === "object") {
        for (const key of ["sessionId", "sessionFile", "id"]) {
          const val = v[key]
          if (typeof val === "string") ids.add(val.replace(/\.jsonl$/i, ""))
        }
      }
    }
    return ids
  } catch {
    return null
  }
}

/**
 * CLAWS_RETAIN_ORPHAN_SESSIONS (default true): keep not-in-index *.jsonl in the
 * sync bundle (finding E / -9). Set "false" to restore pre--9 drop-orphan hygiene.
 */
export function retainOrphanSessionsEnabled() {
  return process.env.CLAWS_RETAIN_ORPHAN_SESSIONS !== "false"
}

/** Skip orphan retention for files larger than this (bytes). */
export const ORPHAN_RETAIN_MAX_BYTES = 5 * 1024 * 1024

/**
 * Bundle-hygiene gate for a single file under agents/<agent>/sessions/.
 * liveIds === null → fail-open (include everything, including reset files).
 *
 * When indexed + retain orphans (default): include not-in-index uuid.jsonl
 * (caller still size-guards via ORPHAN_RETAIN_MAX_BYTES). Always drop reset leftovers.
 */
function isJsonlSessionArtifact(fileName) {
  return (
    fileName.endsWith(".jsonl") ||
    fileName.includes("trajectory") ||
    fileName.includes(".jsonl.")
  )
}

export function agentSqlitePresent(dataDir, agentId) {
  try {
    return fs.existsSync(path.join(dataDir, "agents", agentId, "agent", "openclaw-agent.sqlite"))
  } catch {
    return false
  }
}

export function shouldIncludeSessionArtifact(fileName, liveIds, opts = {}) {
  const retainOrphans = opts.retainOrphans ?? retainOrphanSessionsEnabled()
  // 9.4 doctor converts sessions.json → sqlite. Leftover jsonl plus sqlite
  // blew the 50MB blob-token cap on the Twitter soak (54MB, HTTP 400).
  // Canonical store is sqlite; do not ship jsonl/sessions.json beside it.
  if (opts.sqlitePresent === true) {
    if (fileName === "sessions.json") return false
    if (isJsonlSessionArtifact(fileName)) return false
    if (fileName.endsWith(".sqlite")) return true
    return true
  }
  if (fileName === "sessions.json") return true
  if (fileName.endsWith(".sqlite")) return true
  // Indexed agents: always drop reset leftovers.
  if (liveIds !== null && fileName.includes(".jsonl.reset.")) return false
  // No index → ship everything (fail-open).
  if (liveIds === null) return true

  if (!isJsonlSessionArtifact(fileName)) return true

  const m = fileName.match(UUID_RE)
  if (!m) return true // unrecognized name - keep rather than drop live data
  if (liveIds.has(m[1])) return true
  // Not in index: retain orphans (default) or drop (pre--9 / flag=false).
  return retainOrphans
}

/**
 * Session-key main detection (mirrors snapshot-conversations rules).
 */
export function isMainSessionKey(sessionKey) {
  if (typeof sessionKey !== "string" || sessionKey.length === 0) return false
  if (sessionKey.endsWith(":main")) return true
  const parts = sessionKey.split(":")
  return parts.length === 3 && parts[2] === "main"
}

/**
 * Finding E runtime half: if sessions.json is missing/empty but plain *.jsonl
 * files exist, reconstruct the index. Main = newest mtime among uuid.jsonl;
 * others keyed as agent:<agentId>:session:<uuid>. Idempotent when index present.
 *
 * @returns {{ rebuilt: boolean, agentId?: string, mainUuid?: string, count?: number, reason: string }}
 */
export function rebuildSessionsIndexFromDisk(sessionsDir, agentId) {
  const sqlitePath = path.join(sessionsDir, "..", "agent", "openclaw-agent.sqlite")
  if (fs.existsSync(sqlitePath)) {
    return { rebuilt: false, reason: "sqlite-store-present", agentId }
  }

  const indexPath = path.join(sessionsDir, "sessions.json")
  let existingKeys = 0
  if (fs.existsSync(indexPath)) {
    try {
      const raw = fs.readFileSync(indexPath, "utf8")
      const obj = JSON.parse(raw)
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        existingKeys = Object.keys(obj).length
      }
    } catch {
      existingKeys = 0
    }
  }

  if (existingKeys > 0) {
    return { rebuilt: false, reason: "index-present", count: existingKeys }
  }

  let entries
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return { rebuilt: false, reason: "sessions-dir-unreadable" }
  }

  /** @type {{ uuid: string, mtimeMs: number, size: number }[]} */
  const jsonls = []
  for (const ent of entries) {
    if (!ent.isFile()) continue
    if (!ent.name.endsWith(".jsonl")) continue
    if (ent.name.includes("trajectory") || ent.name.includes(".jsonl.")) continue
    const m = ent.name.match(UUID_RE)
    if (!m) continue
    try {
      const st = fs.statSync(path.join(sessionsDir, ent.name))
      jsonls.push({ uuid: m[1].toLowerCase(), mtimeMs: st.mtimeMs, size: st.size })
    } catch {
      // skip
    }
  }

  if (jsonls.length === 0) {
    return { rebuilt: false, reason: "no-jsonl", agentId }
  }

  jsonls.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size)
  const main = jsonls[0]
  /** @type {Record<string, string>} */
  const index = {}
  index[`agent:${agentId}:main`] = main.uuid
  for (const row of jsonls.slice(1)) {
    index[`agent:${agentId}:session:${row.uuid}`] = row.uuid
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8")
  console.log(
    `[state-sync] rebuild-index agent=${agentId} main=${main.uuid} count=${jsonls.length} reason=missing-or-empty-index`,
  )
  return {
    rebuilt: true,
    reason: "reconstructed",
    agentId,
    mainUuid: main.uuid,
    count: jsonls.length,
  }
}

/**
 * Walk agents/<id>/sessions and rebuild missing/empty indexes. Boot-script entry.
 */
export function rebuildAllSessionsIndexesFromDisk(dataDir = OPENCLAW_DATA_DIR) {
  const agentsRoot = path.join(dataDir, "agents")
  const results = []
  let entries
  try {
    entries = fs.readdirSync(agentsRoot, { withFileTypes: true })
  } catch {
    console.log("[state-sync] rebuild-index no-op (no agents dir)")
    return { results, rebuiltCount: 0 }
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const sessionsDir = path.join(agentsRoot, ent.name, "sessions")
    if (!fs.existsSync(sessionsDir)) continue
    results.push(rebuildSessionsIndexFromDisk(sessionsDir, ent.name))
  }

  const rebuiltCount = results.filter((r) => r.rebuilt).length
  if (rebuiltCount === 0) {
    console.log("[state-sync] rebuild-index no-op (indexes present or no jsonl)")
  }
  return { results, rebuiltCount }
}

function agentSessionsDirFromRelative(relativePath) {
  // agents/<agentId>/sessions/<file>
  const parts = relativePath.split("/")
  if (parts.length >= 4 && parts[0] === "agents" && parts[2] === "sessions") {
    return { agentId: parts[1], fileName: parts.slice(3).join("/"), sessionsPrefix: `agents/${parts[1]}/sessions` }
  }
  return null
}

export function bundleRuntimeState(dataDir = OPENCLAW_DATA_DIR) {
  const files = {}
  let totalSize = 0
  /** @type {Map<string, Set<string> | null>} */
  const liveByAgent = new Map()

  function liveIdsFor(sessionsDir, agentId) {
    if (liveByAgent.has(agentId)) return liveByAgent.get(agentId)
    const ids = loadLiveSessionIds(sessionsDir)
    liveByAgent.set(agentId, ids)
    return ids
  }

  function walkDir(dir, prefix = "") {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!isRuntimeFile(relativePath)) continue
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walkDir(fullPath, relativePath)
      } else if (entry.isFile()) {
        const sess = agentSessionsDirFromRelative(relativePath)
        if (sess) {
          const sessionsDir = path.join(dataDir, sess.sessionsPrefix)
          const liveIds = liveIdsFor(sessionsDir, sess.agentId)
          const sqlitePresent = agentSqlitePresent(dataDir, sess.agentId)
          if (!shouldIncludeSessionArtifact(sess.fileName, liveIds, { sqlitePresent })) continue
          // Size-guard retained orphans (in-index files keep prior unlimited path).
          if (
            liveIds !== null &&
            retainOrphanSessionsEnabled() &&
            sess.fileName.endsWith(".jsonl") &&
            !sess.fileName.includes(".jsonl.")
          ) {
            const m = sess.fileName.match(UUID_RE)
            if (m && !liveIds.has(m[1])) {
              try {
                const st = fs.statSync(fullPath)
                if (st.size > ORPHAN_RETAIN_MAX_BYTES) {
                  console.warn(
                    `[state-sync] skip orphan >${ORPHAN_RETAIN_MAX_BYTES}B: ${relativePath} (${st.size}B)`,
                  )
                  continue
                }
              } catch {
                continue
              }
            }
          }
        }
        try {
          const content = fs.readFileSync(fullPath)
          files[relativePath] = content.toString("base64")
          totalSize += content.length
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walkDir(dataDir)
  return { files, totalSize }
}

function resolveStateEndpoint() {
  const m = process.env.CLAWS_METERING_ENDPOINT
  return m ? m.replace(/\/metering\/?$/, "/state") : null
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

/**
 * POST one activity event via the reporter ingest path
 * (CLAWS_ACTIVITY_ENDPOINT / CLAWS_ACTIVITY_SECRET). Used for near-cap
 * WARNING-class rows and process-manager sync-failure ERROR rows.
 */
export async function postActivityEvent(event, { fetchImpl = fetch } = {}) {
  const ENDPOINT_BASE = process.env.CLAWS_ACTIVITY_ENDPOINT
  const ACTIVITY_SECRET = process.env.CLAWS_ACTIVITY_SECRET
  const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID
  if (!ENDPOINT_BASE || !ACTIVITY_SECRET || !WORKSPACE_ID) {
    return { ok: false, reason: "unconfigured" }
  }
  const url = `${ENDPOINT_BASE.replace(/\/$/, "")}/${encodeURIComponent(WORKSPACE_ID)}`
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Activity-Secret": ACTIVITY_SECRET,
      },
      body: JSON.stringify({ events: [event] }),
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, reason: err?.message ?? String(err) }
  }
}

// Near-cap hysteresis: emit once when crossing ≥80% of ABSOLUTE_MAX; re-arm
// only after compressed size drops below 70%.
let nearCapArmed = true

export function __resetNearCapHysteresis() {
  nearCapArmed = true
}

export function __getNearCapArmed() {
  return nearCapArmed
}

/**
 * Evaluate compressed size against the near-cap band. Returns whether a
 * WARNING-class event should be emitted this call (caller performs the POST).
 */
export function evaluateNearCap(compressedBytes) {
  if (typeof compressedBytes !== "number" || !Number.isFinite(compressedBytes)) {
    return { emit: false, armed: nearCapArmed }
  }
  if (compressedBytes >= NEAR_CAP_WARN_BYTES && nearCapArmed) {
    nearCapArmed = false
    return { emit: true, armed: nearCapArmed, warnBytes: NEAR_CAP_WARN_BYTES }
  }
  if (compressedBytes < NEAR_CAP_REARM_BYTES) {
    nearCapArmed = true
  }
  return { emit: false, armed: nearCapArmed }
}

async function maybeEmitNearCapWarning(compressedBytes, sizeKb, fetchImpl) {
  const decision = evaluateNearCap(compressedBytes)
  if (!decision.emit) return
  // Ingest ALLOWED has no WARNING type - use ERROR with class:"WARNING".
  await postActivityEvent(
    {
      type: "ERROR",
      timestamp: new Date().toISOString(),
      agentId: null,
      runId: null,
      sessionKey: null,
      channelId: null,
      action: `WARNING: runtime state near capacity (${sizeKb}KB compressed, ≥80% of ${ABSOLUTE_MAX_COMPRESSED_BYTES} byte cap)`,
      detail: `compressedBytes=${compressedBytes} warnAt=${NEAR_CAP_WARN_BYTES} rearmBelow=${NEAR_CAP_REARM_BYTES}`,
      metadata: {
        class: "WARNING",
        kind: "state_sync_near_cap",
        compressedBytes,
        sizeKb,
        absoluteMaxCompressedBytes: ABSOLUTE_MAX_COMPRESSED_BYTES,
      },
    },
    { fetchImpl },
  )
}

/**
 * PUT gzip bytes to Vercel Blob using a server-issued client token.
 * Minimal protocol mirror of @vercel/blob put() - no SDK in the image.
 */
export async function putGzipToVercelBlob({
  apiUrl,
  pathname,
  clientToken,
  storeId,
  body,
  fetchImpl = fetch,
  signal,
}) {
  const params = new URLSearchParams({ pathname })
  const base = apiUrl.replace(/\/$/, "")
  const res = await fetchImpl(`${base}/?${params.toString()}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${clientToken}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": storeId,
      "x-vercel-blob-access": "private",
      "x-content-type": "application/gzip",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
    },
    body,
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`blob put HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function parseCount(res) {
  let count = null
  try {
    const body = await res.json()
    if (typeof body?.count === "number") count = body.count
  } catch {
    // Older server / non-JSON - treat as accepted-unconfirmed when ok.
  }
  return count
}

async function uploadViaBlob({
  doFetch,
  STATE_ENDPOINT,
  METERING_SECRET,
  WORKSPACE_ID,
  compressed,
  uncompressedSize,
  fileCount,
  sizeKb,
  sha256,
}) {
  let tokenRes
  try {
    tokenRes = await doFetch(`${STATE_ENDPOINT}/blob-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Metering-Secret": METERING_SECRET,
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        sha256,
        compressedSize: compressed.length,
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    return { status: "error", fileCount, sizeKb, error: err?.message ?? String(err), path: "blob-token" }
  }

  if (!tokenRes.ok) {
    return { status: "rejected", httpStatus: tokenRes.status, fileCount, sizeKb, path: "blob-token" }
  }

  let tokenBody
  try {
    tokenBody = await tokenRes.json()
  } catch (err) {
    return { status: "error", fileCount, sizeKb, error: "blob-token invalid JSON", path: "blob-token" }
  }

  const { pathname, clientToken, storeId, apiUrl } = tokenBody || {}
  if (!pathname || !clientToken || !storeId || !apiUrl) {
    return { status: "error", fileCount, sizeKb, error: "blob-token missing fields", path: "blob-token" }
  }

  let putResult
  try {
    putResult = await putGzipToVercelBlob({
      apiUrl,
      pathname,
      clientToken,
      storeId,
      body: compressed,
      fetchImpl: doFetch,
      signal: AbortSignal.timeout(BLOB_PUT_TIMEOUT_MS),
    })
  } catch (err) {
    return { status: "error", fileCount, sizeKb, error: err?.message ?? String(err), path: "blob-put" }
  }

  const blobUrl = putResult?.url || putResult?.downloadUrl
  if (!blobUrl) {
    return { status: "error", fileCount, sizeKb, error: "blob put returned no url", path: "blob-put" }
  }

  let finRes
  try {
    finRes = await doFetch(`${STATE_ENDPOINT}/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Metering-Secret": METERING_SECRET,
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        blobUrl,
        sha256,
        uncompressedSize,
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    return { status: "error", fileCount, sizeKb, error: err?.message ?? String(err), path: "finalize" }
  }

  if (!finRes.ok) {
    return { status: "rejected", httpStatus: finRes.status, fileCount, sizeKb, path: "finalize" }
  }

  const count = await parseCount(finRes)
  if (count === 0) {
    return { status: "rejected", count: 0, fileCount, sizeKb, path: "finalize" }
  }
  return {
    status: count === null ? "accepted-unconfirmed" : "persisted",
    count,
    fileCount,
    sizeKb,
    path: "blob",
  }
}

// One bundle + gzip + upload. Returns a STRUCTURED result; callers interpret it
// (process-manager reproduces its existing log lines; the route maps to a
// status code). status values:
//   unconfigured         - missing endpoint/secret/workspace; nothing attempted
//   empty                - no runtime files to sync (nothing to persist)
//   persisted            - server confirmed count>=1 (the only "guaranteed" case)
//   accepted-unconfirmed - HTTP ok but no numeric count (older server skew)
//   rejected             - HTTP !ok, OR accepted with count===0 (row missing)
//   error                - network/timeout/abort
async function doStateSync({ bundleFn = bundleRuntimeState, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? fetch
  const STATE_ENDPOINT = resolveStateEndpoint()
  const METERING_SECRET = process.env.CLAWS_METERING_SECRET
  const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID
  if (!STATE_ENDPOINT || !METERING_SECRET || !WORKSPACE_ID) {
    return { status: "unconfigured" }
  }

  const bundle = bundleFn()
  const fileCount0 = Object.keys(bundle.files).length
  if (fileCount0 === 0) {
    return { status: "empty", fileCount: 0, sizeKb: 0 }
  }

  const sized = applySizeAwareBundle(bundle, { gzipSync: zlib.gzipSync })
  const jsonStr = JSON.stringify(sized.bundle)
  const compressed = sized.compressed
  const fileCount = Object.keys(sized.bundle.files).length
  const sizeKb = Math.round(compressed.length / 1024)
  const uncompressedSize = Buffer.byteLength(jsonStr)
  const sha256 = sha256Hex(compressed)

  if (sized.warning) {
    await postActivityEvent(
      {
        type: "TASK_START",
        timestamp: new Date().toISOString(),
        agentId: null,
        runId: null,
        sessionKey: null,
        channelId: null,
        action: `WARNING: runtime state trimmed (${sized.warning})`,
        detail: `dropped=${sized.dropped.length} compressedBytes=${compressed.length} stillOverHard=${sized.stillOverHard}`,
        metadata: {
          eventKind: "runtime_state_trimmed",
          warning: sized.warning,
          droppedCount: sized.dropped.length,
          compressedBytes: compressed.length,
          stillOverHard: sized.stillOverHard,
        },
      },
      { fetchImpl: doFetch },
    )
  }

  // Near-cap WARNING (pre-PUT) - does not block the upload attempt.
  await maybeEmitNearCapWarning(compressed.length, sizeKb, doFetch)

  return uploadViaBlob({
    doFetch,
    STATE_ENDPOINT,
    METERING_SECRET,
    WORKSPACE_ID,
    compressed,
    uncompressedSize,
    fileCount,
    sizeKb,
    sha256,
  })
}

// Per-process in-flight guard. A second caller in the SAME process awaits the
// in-flight sync instead of starting a parallel bundle+upload (see the
// cross-process note at the top - this guard is intentionally per-process).
let inFlight = null

export function runStateSync(opts) {
  if (inFlight) return inFlight
  inFlight = doStateSync(opts).finally(() => {
    inFlight = null
  })
  return inFlight
}

// Test-only: lets a test assert no sync is wedged between cases.
export function __isSyncInFlight() {
  return inFlight !== null
}
