import { prisma } from "@/lib/db"
import { parseDeliverableMetadata } from "@/lib/artifacts/deliverable-kind"
import { applyFileVersionDecision } from "@/lib/artifacts/apply-decision"
import { findDeliverableApprovalRequest } from "@/lib/openclaw/pending-approval"
import { resolveCustomerNudge } from "@/lib/alerts/customer-nudge"
import { PENDING_APPROVAL_NUDGE_CONDITION } from "@/lib/artifacts/pending-approvals"
import { respondFailureMessage } from "@/lib/artifacts/approval-version"
import { loadApprovalVersionStates } from "@/lib/artifacts/supersede-versions"

export type DeliverableRespondAction = "approve" | "reject"

export type DeliverableRespondOk = {
  ok: true
  id: string
  action: DeliverableRespondAction
  originalRequestId: string
  fileVersionId: string | null
  liveWriteOk: boolean | null
}

export type DeliverableRespondFail = {
  ok: false
  error: string
  message: string
  status: number
}

function fail(error: string, status: number, latestLabel?: string | null): DeliverableRespondFail {
  return { ok: false, error, message: respondFailureMessage(error, latestLabel), status }
}

export type DeliverableRespondResult = DeliverableRespondOk | DeliverableRespondFail

export async function findLatestPendingDeliverableApproval(args: {
  workspaceId: string
  hint?: string | null
}): Promise<{ id: string; fileVersionId: string | null } | null> {
  const rows = await prisma.activityLog.findMany({
    where: { workspaceId: args.workspaceId, actionType: "HUMAN_REQUEST" },
    orderBy: { timestamp: "desc" },
    take: 20,
  })
  const hint = args.hint?.trim().toLowerCase() ?? ""
  for (const row of rows) {
    const meta = parseDeliverableMetadata(row.metadata)
    if (hint) {
      const path = (meta.logicalPath ?? "").toLowerCase()
      const action = row.action.toLowerCase()
      if (!path.includes(hint) && !action.includes(hint)) continue
    }
    const existing = await prisma.activityLog.findFirst({
      where: {
        workspaceId: args.workspaceId,
        actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
        metadata: { contains: row.id },
      },
      select: { id: true },
    })
    if (existing) continue
    if (meta.fileVersionId && meta.logicalPath) {
      const states = await loadApprovalVersionStates({
        workspaceId: args.workspaceId,
        logicalPaths: [meta.logicalPath],
      })
      if (!states.get(meta.fileVersionId)?.isDecidable) continue
    }
    return { id: row.id, fileVersionId: meta.fileVersionId }
  }
  return null
}

export async function respondToDeliverable(args: {
  workspaceId: string
  activityLogId?: string
  fileVersionId?: string
  action: DeliverableRespondAction
  feedback?: string | null
  respondedBy: string
}): Promise<DeliverableRespondResult> {
  let requestId = args.activityLogId
  if (!requestId && args.fileVersionId) {
    const found = await findDeliverableApprovalRequest({
      workspaceId: args.workspaceId,
      fileVersionId: args.fileVersionId,
    })
    requestId = found?.id
  }
  if (!requestId) return fail("pending_approval_not_found", 404)

  const originalRequest = await prisma.activityLog.findFirst({
    where: { id: requestId, workspaceId: args.workspaceId, actionType: "HUMAN_REQUEST" },
  })
  if (!originalRequest) return fail("pending_approval_not_found", 404)

  const meta = parseDeliverableMetadata(originalRequest.metadata)
  const resolvedFileVersionId = meta.fileVersionId ?? args.fileVersionId ?? null
  const logicalPath = meta.logicalPath

  if (resolvedFileVersionId && logicalPath) {
    const states = await loadApprovalVersionStates({
      workspaceId: args.workspaceId,
      logicalPaths: [logicalPath],
    })
    const state = states.get(resolvedFileVersionId)
    if (!state) return fail("file_version_not_found", 404)
    if (state.decision === "APPROVED") return fail("already_approved", 409)
    if (state.decision === "REJECTED") return fail("already_rejected", 409)
    if (!state.isDecidable) return fail("superseded", 409, state.latestLabel)
  }

  const existingResponse = await prisma.activityLog.findFirst({
    where: {
      workspaceId: args.workspaceId,
      actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      metadata: { contains: requestId },
    },
  })
  if (existingResponse) {
    const kind = existingResponse.actionType === "HUMAN_REJECT" ? "already_rejected" : "already_approved"
    return fail(kind, 409)
  }

  const responseLog = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      agentName: originalRequest.agentName,
      agentSlug: originalRequest.agentSlug,
      action:
        args.action === "approve"
          ? `Human approved: ${originalRequest.action}`
          : `Human rejected: ${originalRequest.action}${args.feedback ? ` - "${args.feedback}"` : ""}`,
      actionType: args.action === "approve" ? "HUMAN_APPROVE" : "HUMAN_REJECT",
      metadata: JSON.stringify({
        originalRequestId: requestId,
        fileVersionId: resolvedFileVersionId,
        feedback: args.feedback || null,
        respondedBy: args.respondedBy,
        respondedAt: new Date().toISOString(),
      }),
    },
  })

  let liveWriteOk: boolean | null = null
  if (resolvedFileVersionId) {
    const applied = await applyFileVersionDecision({
      workspaceId: args.workspaceId,
      fileVersionId: resolvedFileVersionId,
      decision: args.action === "approve" ? "APPROVED" : "REJECTED",
      reason: args.feedback || null,
      decidedBy: args.respondedBy,
    })
    if ("error" in applied) {
      return fail(applied.error, applied.status)
    }
    liveWriteOk = applied.liveWriteOk
  }

  try {
    await resolveCustomerNudge({
      workspaceId: args.workspaceId,
      condition: PENDING_APPROVAL_NUDGE_CONDITION,
    })
  } catch {
    /* resolve is best-effort; the decision already landed */
  }

  return {
    ok: true,
    id: responseLog.id,
    action: args.action,
    originalRequestId: requestId,
    fileVersionId: resolvedFileVersionId,
    liveWriteOk,
  }
}
