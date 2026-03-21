import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const { positions } = await req.json() as {
    positions: Array<{ id: string; positionX: number; positionY: number }>
  }

  await prisma.$transaction(
    positions.map((pos) =>
      prisma.agent.update({ where: { id: pos.id }, data: { positionX: pos.positionX, positionY: pos.positionY } })
    )
  )

  return apiSuccess({ updated: positions.length })
}
