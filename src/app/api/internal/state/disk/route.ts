import { NextRequest } from "next/server"
import { assertSyncCredential } from "@/lib/openclaw/state-sync-auth"
import { persistRuntimeStateSnapshot } from "@/lib/openclaw/state-snapshot"
import { isSelfHost } from "@/lib/profile"

export const maxDuration = 60

/**
 * Self-host snapshot ingest. The runtime POSTs gzip bytes here instead of
 * Vercel Blob. Hosted callers get 404. Blob finalize stays the hosted path.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!isSelfHost()) {
    return new Response("Not found", { status: 404 })
  }

  let body: { workspaceId?: unknown; bytesBase64?: unknown; uncompressedSize?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return new Response("JSON body required", { status: 400 })
  }
  if (typeof body.workspaceId !== "string" || typeof body.bytesBase64 !== "string") {
    return new Response("workspaceId and bytesBase64 are required", { status: 400 })
  }
  if (!(await assertSyncCredential(req, body.workspaceId))) {
    return new Response("Unauthorized", { status: 401 })
  }
  const bytes = Buffer.from(body.bytesBase64, "base64")
  const uncompressedSize =
    typeof body.uncompressedSize === "number" ? body.uncompressedSize : bytes.length
  const { count } = await persistRuntimeStateSnapshot({
    workspaceId: body.workspaceId,
    stateBuffer: bytes,
    uncompressedSize,
  })
  if (count === 0) {
    return new Response("no container state row", { status: 404 })
  }
  return Response.json({ persisted: true })
}
