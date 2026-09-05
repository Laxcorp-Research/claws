import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { log } from "@/lib/logger"
import { flushHeldChatSends } from "@/lib/openclaw/chat-send-hold"

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { deploymentId, status, errorMessage } = body as { deploymentId: string; status?: string; errorMessage?: string }

  if (!deploymentId) return ERRORS.VALIDATION("deploymentId is required")

  const finalStatus = status === "FAILED" ? "FAILED" : "COMPLETED"

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status: finalStatus,
      ...(finalStatus === "COMPLETED" && { completedAt: new Date() }),
      ...(errorMessage && { errorMessage }),
    },
  })

  if (finalStatus === "COMPLETED") {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "RUNNING" },
    })
    log.deployEvent({ event: "completed", workspaceId, userId: user.id })
    void flushHeldChatSends(workspaceId).catch((err) => {
      log.warn("deploy complete: held chat flush failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  return apiSuccess({ status: finalStatus })
}
