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

export function bundleRuntimeState(dataDir = OPENCLAW_DATA_DIR) {
  const files = {}
  let totalSize = 0

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
