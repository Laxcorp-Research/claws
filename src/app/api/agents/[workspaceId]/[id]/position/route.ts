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

  const { positionX, positionY } = await req.json()
  await prisma.agent.update({ where: { id }, data: { positionX, positionY } })
  return apiSuccess({ updated: true })
}
