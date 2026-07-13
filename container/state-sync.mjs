// Shared runtime-state sync — single source of truth for bundling the OpenClaw
// data dir and uploading it to the Claws control plane.
//
// Imported by BOTH:
//   - container/process-manager.mjs  (image: /usr/local/bin/process-manager.mjs
//     → `./state-sync.mjs`) — the periodic 5-min interval + SIGTERM final sync.
//   - container/claws-activity-reporter/index.mjs (image:
//     /opt/claws-activity-reporter/index.mjs → `../state-sync.mjs`) — the
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
//   atomic `updateMany` (one-shot column write) — never a read-modify-write.
//   (Legacy /upload is reject-only 413 USE_BLOB.)
// Given that invariant: concurrent uploads can't tear or partially-overwrite
// the row; the worst case is an equal-or-fresher snapshot (last writer wins,
// both bundles captured seconds apart). And on the Stop/hibernate path the
// container is deleted right after sync-now's confirmed 200, so the interval
// stops — there is no later writer to stale-overwrite what sync-now persisted.
// sync-now's 200 (count>=1) is the guarantee: "state as of Stop is persisted."
// (A regression test locks the atomic-upload invariant; if anyone refactors the
// upload into a read-modify-write, that test fails.)
//
// ── BLOB TRANSPORT (D2 / PR-1) — sole sync path ──
//   1) POST /state/blob-token → clientToken
//   2) PUT gzip bytes to Vercel Blob API (bypasses edge body cap)
//   3) POST /state/finalize { blobUrl, sha256, sizes } — platform verifies hash
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
export const ABSOLUTE_MAX_COMPRESSED_BYTES = 50 * 1024 * 1024
export const NEAR_CAP_WARN_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.8) // 40MB
export const NEAR_CAP_REARM_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.7) // 35MB

const UUID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

// Config files are re-delivered via env vars at every boot (deriveContainerEnv),
// so they are NOT runtime state — exclude them from the snapshot. Everything
// else under the data dir (agents/<id>/sessions/*.jsonl, MEMORY.md, logs,
// caches) IS runtime state.
const CONFIG_FILES = new Set(["openclaw.json", ".env", "cron"])

export function isRuntimeFile(relativePath) {
  const topLevel = relativePath.split("/")[0]
  if (CONFIG_FILES.has(topLevel)) return false
  if (topLevel.startsWith(".") && topLevel !== ".openclaw") return false
  if (topLevel === "node_modules") return false
  return true
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
 * Bundle-hygiene gate for a single file under agents/<agent>/sessions/.
 * liveIds === null → fail-open (include everything, including reset files).
 */
export function shouldIncludeSessionArtifact(fileName, liveIds) {
  if (fileName === "sessions.json") return true
  // Indexed agents: always drop reset leftovers.
  if (liveIds !== null && fileName.includes(".jsonl.reset.")) return false
  // No index → ship everything (fail-open).
  if (liveIds === null) return true

  const isJsonlOrTrajectory =
    fileName.endsWith(".jsonl") ||
    fileName.includes("trajectory") ||
    fileName.includes(".jsonl.")
  if (!isJsonlOrTrajectory) return true

  const m = fileName.match(UUID_RE)
  if (!m) return true // unrecognized name — keep rather than drop live data
  return liveIds.has(m[1])
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
          if (!shouldIncludeSessionArtifact(sess.fileName, liveIds)) continue
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
  // Ingest ALLOWED has no WARNING type — use ERROR with class:"WARNING".
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
 * Minimal protocol mirror of @vercel/blob put() — no SDK in the image.
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
    // Older server / non-JSON — treat as accepted-unconfirmed when ok.
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
//   unconfigured         — missing endpoint/secret/workspace; nothing attempted
//   empty                — no runtime files to sync (nothing to persist)
//   persisted            — server confirmed count>=1 (the only "guaranteed" case)
//   accepted-unconfirmed — HTTP ok but no numeric count (older server skew)
//   rejected             — HTTP !ok, OR accepted with count===0 (row missing)
//   error                — network/timeout/abort
async function doStateSync({ bundleFn = bundleRuntimeState, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? fetch
  const STATE_ENDPOINT = resolveStateEndpoint()
  const METERING_SECRET = process.env.CLAWS_METERING_SECRET
  const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID
  if (!STATE_ENDPOINT || !METERING_SECRET || !WORKSPACE_ID) {
    return { status: "unconfigured" }
  }

  const bundle = bundleFn()
  const fileCount = Object.keys(bundle.files).length
  if (fileCount === 0) {
    return { status: "empty", fileCount: 0, sizeKb: 0 }
  }

  const jsonStr = JSON.stringify(bundle)
  const compressed = zlib.gzipSync(Buffer.from(jsonStr))
  const sizeKb = Math.round(compressed.length / 1024)
  const uncompressedSize = Buffer.byteLength(jsonStr)
  const sha256 = sha256Hex(compressed)

  // Near-cap WARNING (pre-PUT) — does not block the upload attempt.
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
// cross-process note at the top — this guard is intentionally per-process).
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
