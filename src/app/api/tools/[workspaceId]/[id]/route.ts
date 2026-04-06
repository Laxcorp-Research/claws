import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getComposio } from "@/lib/composio"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const conn = await prisma.toolConnection.findFirst({ where: { id, workspaceId } })
  if (!conn) return ERRORS.NOT_FOUND("Tool connection")

  const body = await req.json()
  const allowed = ["status", "lastError", "lastTestedAt", "composioConnectionId", "composioEntityId"]
  const updates: Record<string, unknown> = {}
  for (const f of allowed) { if (body[f] !== undefined) updates[f] = body[f] }

  const updated = await prisma.toolConnection.update({
    where: { id },
    data: updates,
    select: { id: true, toolSlug: true, displayName: true, connectionType: true, keyHint: true, status: true, lastTestedAt: true, lastError: true },
  })
  return apiSuccess(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const conn = await prisma.toolConnection.findFirst({ where: { id, workspaceId } })
  if (!conn) return ERRORS.NOT_FOUND("Tool connection")

  if (conn.composioConnectionId) {
    const composio = getComposio()
    if (composio) {
      try {
        await composio.connectedAccounts.delete(conn.composioConnectionId)
      } catch {
        // still remove local row
      }
    }
  }

  await prisma.toolConnection.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
