import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { respondToDeliverable } from "@/lib/artifacts/respond-deliverable"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { id: workspaceId } = await params
  const body = await request.json()
  const { activityLogId, fileVersionId, action, feedback } = body as {
    activityLogId?: string
    fileVersionId?: string
    action?: string
    feedback?: string
  }

  if ((!activityLogId && !fileVersionId) || !action || !["approve", "reject"].includes(action)) {
    return ERRORS.VALIDATION("Required: activityLogId or fileVersionId, action (approve|reject)")
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId: user.id },
  })
  if (!workspace) return ERRORS.NOT_FOUND("workspace")

  const result = await respondToDeliverable({
    workspaceId,
    activityLogId,
    fileVersionId,
    action: action as "approve" | "reject",
    feedback,
    respondedBy: user.email ?? user.id,
  })
  if (!result.ok) {
    if (result.error === "already_responded") {
      return apiError("ALREADY_RESPONDED", "Already responded to this request", 409)
    }
    if (result.error === "pending_approval_not_found") {
      return ERRORS.NOT_FOUND("pending approval")
    }
    return apiError("DECISION_LEDGER_FAILED", result.error, result.status)
  }

  return apiSuccess({
    id: result.id,
    action: result.action,
    originalRequestId: result.originalRequestId,
    fileVersionId: result.fileVersionId,
    liveWriteOk: result.liveWriteOk,
  })
}
