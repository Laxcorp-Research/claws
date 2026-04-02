import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { id: workspaceId } = await params
  const body = await request.json()
  const { activityLogId, action, feedback } = body as {
    activityLogId?: string
    action?: string
    feedback?: string
  }

  if (!activityLogId || !action || !["approve", "reject"].includes(action)) {
    return ERRORS.VALIDATION("Required: activityLogId, action (approve|reject)")
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: user.id },
  })
  if (!workspace) return ERRORS.NOT_FOUND("workspace")

  const originalRequest = await prisma.activityLog.findFirst({
    where: { id: activityLogId, workspaceId, actionType: "HUMAN_REQUEST" },
  })
  if (!originalRequest) return ERRORS.NOT_FOUND("pending approval")

  const existingResponse = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      metadata: { contains: activityLogId },
    },
  })
  if (existingResponse) {
    return apiError("ALREADY_RESPONDED", "Already responded to this request", 409)
  }

  const responseLog = await prisma.activityLog.create({
    data: {
      workspaceId,
      agentName: originalRequest.agentName,
      agentSlug: originalRequest.agentSlug,
      action: action === "approve"
        ? `Human approved: ${originalRequest.action}`
        : `Human rejected: ${originalRequest.action}${feedback ? ` - "${feedback}"` : ""}`,
      actionType: action === "approve" ? "HUMAN_APPROVE" : "HUMAN_REJECT",
      metadata: JSON.stringify({
        originalRequestId: activityLogId,
        feedback: feedback || null,
        respondedBy: user.email,
        respondedAt: new Date().toISOString(),
      }),
    },
  })

  return apiSuccess({
    id: responseLog.id,
    action,
    originalRequestId: activityLogId,
  })
}
