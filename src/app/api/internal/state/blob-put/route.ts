import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { isSelfHost } from "@/lib/profile"
import { ABSOLUTE_MAX_COMPRESSED_BYTES } from "@/lib/openclaw/state-sync-limits"
import { stageSelfHostBlob } from "@/lib/openclaw/self-host-blob"

export const maxDuration = 60

/**
 * Self-host stand-in for the Vercel Blob PUT the published runtime already
 * performs. Hosted callers get 404. The bearer is the clientToken issued by
 * blob-token (the workspace sync secret).
 */
export async function PUT(req: NextRequest): Promise<Response> {
  if (!isSelfHost()) {
    return new Response("Not found", { status: 404 })
  }
  const pathname = req.nextUrl.searchParams.get("pathname")?.trim() ?? ""
  const workspaceId = pathname.match(/^runtime-state\/([a-z0-9_-]+)\.gz$/i)?.[1] ?? ""
  if (!workspaceId) {
    return Response.json({ success: false, error: "Invalid pathname" }, { status: 400 })
  }
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { syncSecretEncrypted: true },
  })
  let expected = ""
  if (row?.syncSecretEncrypted) {
    try {
      expected = decrypt(row.syncSecretEncrypted)
    } catch {
      expected = ""
    }
  }
  if (!expected || bearer !== expected) {
    return new Response("Unauthorized", { status: 401 })
  }
  const bytes = Buffer.from(await req.arrayBuffer())
  if (bytes.length === 0 || bytes.length > ABSOLUTE_MAX_COMPRESSED_BYTES) {
    return Response.json({ success: false, error: "Invalid body" }, { status: 413 })
  }
  const url = stageSelfHostBlob(pathname, bytes)
  return Response.json({ url })
}
