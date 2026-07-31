import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { normalizeContextNote } from "@/lib/openclaw/workflow-language"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const existing = await prisma.agentConnection.findFirst({ where: { id, workspaceId } })
  if (!existing) return ERRORS.NOT_FOUND("Connection")

  const body = await req.json() as {
    label?: string | null
    contextNote?: string | null
  }

  const updates: { label?: string | null; contextNote?: string | null; condition?: "ON_COMPLETE" } = {}
  if (body.label !== undefined) updates.label = body.label
  if (body.contextNote !== undefined) updates.contextNote = normalizeContextNote(body.contextNote)
  // X2: never accept condition writes other than coerce-to-ON_COMPLETE.
  updates.condition = "ON_COMPLETE"

  const connection = await prisma.agentConnection.update({
    where: { id },
    data: updates,
  })
  return apiSuccess(connection)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const existing = await prisma.agentConnection.findFirst({ where: { id, workspaceId } })
  if (!existing) return ERRORS.NOT_FOUND("Connection")

  await prisma.agentConnection.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
