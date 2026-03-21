import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (body.condition !== undefined) updates.condition = body.condition
  if (body.label !== undefined) updates.label = body.label
  if (body.conditionExpr !== undefined) updates.conditionExpr = body.conditionExpr

  const connection = await prisma.agentConnection.update({ where: { id }, data: updates })
  return apiSuccess(connection)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  await prisma.agentConnection.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
