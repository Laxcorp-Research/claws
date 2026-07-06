import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const custom = await prisma.customToolConnection.findFirst({ where: { id, workspaceId } })
  if (!custom) return ERRORS.NOT_FOUND("Custom API connection")

  await prisma.customToolConnection.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
