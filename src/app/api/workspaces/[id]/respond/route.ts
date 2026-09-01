import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { parseDeliverableMetadata } from "@/lib/artifacts/deliverable-kind"
import { applyFileVersionDecision } from "@/lib/artifacts/apply-decision"
import { findDeliverableApprovalRequest } from "@/lib/openclaw/pending-approval"

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

  let requestId = activityLogId
  if (!requestId && fileVersionId) {
    const found = await findDeliverableApprovalRequest({ workspaceId, fileVersionId })
    requestId = found?.id
  }
  if (!requestId) return ERRORS.NOT_FOUND("pending approval")

  const originalRequest = await prisma.activityLog.findFirst({
    where: { id: requestId, workspaceId, actionType: "HUMAN_REQUEST" },
  })
  if (!originalRequest) return ERRORS.NOT_FOUND("pending approval")

  const existingResponse = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      metadata: { contains: requestId },
    },
  })
  if (existingResponse) {
    return apiError("ALREADY_RESPONDED", "Already responded to this request", 409)
  }

  const meta = parseDeliverableMetadata(originalRequest.metadata)
  const resolvedFileVersionId = meta.fileVersionId ?? fileVersionId ?? null

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
        originalRequestId: requestId,
        fileVersionId: resolvedFileVersionId,
        feedback: feedback || null,
        respondedBy: user.email,
        respondedAt: new Date().toISOString(),
      }),
    },
  })

  let decision: { fileVersionId: string; liveWriteOk: boolean } | null = null
  if (resolvedFileVersionId) {
    const applied = await applyFileVersionDecision({
      workspaceId,
      fileVersionId: resolvedFileVersionId,
      decision: action === "approve" ? "APPROVED" : "REJECTED",
      reason: feedback || null,
      decidedBy: user.email ?? user.id,
    })
    if ("error" in applied) {
      return apiError("DECISION_LEDGER_FAILED", applied.error, applied.status)
    }
    decision = { fileVersionId: applied.fileVersionId, liveWriteOk: applied.liveWriteOk }
  }

  return apiSuccess({
    id: responseLog.id,
    action,
    originalRequestId: requestId,
    fileVersionId: resolvedFileVersionId,
    liveWriteOk: decision?.liveWriteOk ?? null,
  })
}
