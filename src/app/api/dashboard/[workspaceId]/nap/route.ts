import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { hibernateWorkspace } from "@/lib/hibernation/manager"

export const maxDuration = 60

/**
 * User-triggered nap. Same hibernate path as the hosted cron
 * (sync, then stop compute, keep the container and its volume).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, status: true, containerId: true },
  })
  if (!workspace) return ERRORS.NOT_FOUND("Workspace")
  if (workspace.userId !== user.id) return ERRORS.FORBIDDEN()
  if (workspace.status !== "RUNNING" || !workspace.containerId) {
    return apiError("INVALID_STATE", `Cannot nap a workspace in ${workspace.status} state`, 400)
  }

  const result = await hibernateWorkspace(workspaceId)
  if (!result.hibernated) {
    return apiError("NAP_REFUSED", result.reason, 409)
  }
  return apiSuccess({ status: "HIBERNATED" })
}
