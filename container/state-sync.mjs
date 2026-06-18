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
//   INVARIANT: /api/internal/state/upload writes the snapshot with a SINGLE
//   atomic `updateMany` (one-shot column write) — never a read-modify-write.
// Given that invariant: concurrent uploads can't tear or partially-overwrite
// the row; the worst case is an equal-or-fresher snapshot (last writer wins,
// both bundles captured seconds apart). And on the Stop/hibernate path the
// container is deleted right after sync-now's confirmed 200, so the interval
// stops — there is no later writer to stale-overwrite what sync-now persisted.
// sync-now's 200 (count>=1) is the guarantee: "state as of Stop is persisted."
// (A regression test locks the atomic-upload invariant; if anyone refactors the
// upload into a read-modify-write, that test fails.)

import fs from "fs"
import path from "path"
import zlib from "zlib"

export const OPENCLAW_DATA_DIR = "/home/node/.openclaw"
const UPLOAD_TIMEOUT_MS = 30_000

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

  let res
  try {
    res = await doFetch(`${STATE_ENDPOINT}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Metering-Secret": METERING_SECRET,
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        compressedState: compressed.toString("base64"),
        uncompressedSize: Buffer.byteLength(jsonStr),
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    return { status: "error", fileCount, sizeKb, error: err?.message ?? String(err) }
  }

  if (!res.ok) {
    return { status: "rejected", httpStatus: res.status, fileCount, sizeKb }
  }

  let count = null
  try {
    const body = await res.json()
    if (typeof body?.count === "number") count = body.count
  } catch {
    // Older server that doesn't return count — treat as accepted-unconfirmed.
  }

  if (count === 0) {
    // Accepted by the server but no ContainerState row matched → NOT persisted.
    return { status: "rejected", count: 0, fileCount, sizeKb }
  }
  return { status: count === null ? "accepted-unconfirmed" : "persisted", count, fileCount, sizeKb }
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
