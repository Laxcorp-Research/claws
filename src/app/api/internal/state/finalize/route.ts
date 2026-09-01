import { NextRequest } from "next/server"
import { get, del } from "@vercel/blob"
import { log } from "@/lib/logger"
import {
  persistRuntimeStateSnapshot,
  readPersistedSnapshotSha256,
  sha256Hex,
  timingSafeEqualHex,
} from "@/lib/openclaw/state-snapshot"
import { ABSOLUTE_MAX_COMPRESSED_BYTES } from "@/lib/openclaw/state-sync-limits"
import { assertMeteringSecret } from "@/lib/openclaw/state-sync-auth"
import { extractDeliverablesFromGzip } from "@/lib/artifacts/extract-deliverables"

export const maxDuration = 60

/**
 * F3.iii: verify sha256 via bounded server-side Blob fetch (get), not metadata.
 * DI via createFinalizeHandler - never a second arg on the exported POST
 * (Next RouteHandlerConfig rejects non-framework context shapes).
 */
export type FetchBlobBytes = (url: string) => Promise<Buffer>
export type DeleteBlob = (url: string) => Promise<void>

export type FinalizeHandlerDeps = {
  fetchBlobBytes?: FetchBlobBytes
  deleteBlob?: DeleteBlob
}

async function defaultFetchBlobBytes(url: string): Promise<Buffer> {
  const result = await get(url, { access: "private" })
  if (!result || !result.stream) {
    throw new Error("Blob not found")
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = result.stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = Buffer.from(value)
    total += chunk.length
    if (total > ABSOLUTE_MAX_COMPRESSED_BYTES) {
      throw new Error("Blob exceeds absolute max size")
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function defaultDeleteBlob(url: string): Promise<void> {
  await del(url)
}

async function bestEffortDeleteBlob(
  blobUrl: string,
  workspaceId: string,
  deleteBlob: DeleteBlob,
): Promise<void> {
  try {
    await deleteBlob(blobUrl)
  } catch (err) {
    log.warn("State finalize: blob deletion failed (continuing)", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function createFinalizeHandler(
  deps: FinalizeHandlerDeps = {},
): (req: NextRequest) => Promise<Response> {
  const fetchBytes = deps.fetchBlobBytes ?? defaultFetchBlobBytes
  const deleteBlob = deps.deleteBlob ?? defaultDeleteBlob

  return async function POST(req: NextRequest): Promise<Response> {
    if (!assertMeteringSecret(req)) {
      return new Response("Unauthorized", { status: 401 })
    }

    let body: {
      workspaceId?: unknown
      blobUrl?: unknown
      sha256?: unknown
      uncompressedSize?: unknown
    }
    try {
      body = await req.json()
    } catch {
      return Response.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""
    const blobUrl = typeof body.blobUrl === "string" ? body.blobUrl.trim() : ""
    const sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : ""
    const uncompressedSize =
      typeof body.uncompressedSize === "number" && Number.isFinite(body.uncompressedSize)
        ? body.uncompressedSize
        : 0

    if (!workspaceId || !blobUrl || !/^[a-f0-9]{64}$/.test(sha256)) {
      return Response.json({ success: false, error: "Missing or invalid fields" }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(blobUrl)
    } catch {
      return Response.json({ success: false, error: "Invalid blobUrl" }, { status: 400 })
    }
    const hostOk =
      parsed.hostname.endsWith(".blob.vercel-storage.com") ||
      parsed.hostname === "blob.vercel-storage.com" ||
      process.env.STATE_SYNC_BLOB_URL_ALLOWLIST?.split(",").includes(parsed.hostname)
    if (!hostOk) {
      return Response.json({ success: false, error: "blobUrl host not allowed" }, { status: 400 })
    }

    let stateBuffer: Buffer
    try {
      stateBuffer = await fetchBytes(blobUrl)
    } catch (err) {
      log.warn("State finalize: blob fetch failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
      return Response.json({ success: false, error: "Blob fetch failed" }, { status: 502 })
    }

    if (stateBuffer.length > ABSOLUTE_MAX_COMPRESSED_BYTES) {
      return Response.json({ success: false, error: "State too large" }, { status: 413 })
    }

    const actual = sha256Hex(stateBuffer)
    if (!timingSafeEqualHex(actual, sha256)) {
      log.warn("State finalize: sha256 mismatch - refusing persist", {
        workspaceId,
        expected: sha256.slice(0, 8),
        actual: actual.slice(0, 8),
      })
      return Response.json(
        { success: false, error: "SHA256_MISMATCH", expected: sha256, actual },
        { status: 400 },
      )
    }

    // Idempotency: same (workspaceId, sha256) already persisted → noop.
    // Mutation: remove this check → duplicate finalize would call updateMany again.
    const existingSha = await readPersistedSnapshotSha256(workspaceId)
    if (existingSha !== null && timingSafeEqualHex(existingSha, actual)) {
      await bestEffortDeleteBlob(blobUrl, workspaceId, deleteBlob)
      return Response.json({ success: true, noop: true, count: 1, sha256: actual })
    }

    const { count } = await persistRuntimeStateSnapshot({
      workspaceId,
      stateBuffer,
      uncompressedSize,
    })

    if (count === 0) {
      log.warn("State finalize: no ContainerState row - discarded", { workspaceId })
    } else {
      log.info("Runtime state snapshot stored (blob finalize)", {
        workspaceId,
        compressedBytes: stateBuffer.length,
        uncompressedBytes: uncompressedSize,
      })
      try {
        await extractDeliverablesFromGzip({ workspaceId, gzip: stateBuffer })
      } catch (extractErr) {
        log.warn("State finalize: deliverable extract failed (continuing)", {
          workspaceId,
          error: extractErr instanceof Error ? extractErr.message : String(extractErr),
        })
      }
    }

    // Post-persist cleanup: never fail the response if del() throws.
    if (count >= 1) {
      await bestEffortDeleteBlob(blobUrl, workspaceId, deleteBlob)
    }

    return Response.json({ success: true, count, sha256: actual, noop: false })
  }
}

/** Framework-conformant: exactly (req) - DI lives on createFinalizeHandler. */
export const POST = createFinalizeHandler()
