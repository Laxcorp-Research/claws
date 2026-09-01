import { respondToDeliverable, findLatestPendingDeliverableApproval } from "@/lib/artifacts/respond-deliverable"
import { log } from "@/lib/logger"

export type ApprovalCommand = {
  action: "approve" | "reject"
  hint: string | null
}

/**
 * Exact text commands only. "please approve this" does not match.
 * APPROVE / REJECT /approve /reject, optional path/title hint.
 */
export function parseApprovalCommand(text: string): ApprovalCommand | null {
  if (typeof text !== "string") return null
  const trimmed = text.trim()
  const match = /^(?:\/)?(approve|reject)\b(?:\s+(.+))?$/i.exec(trimmed)
  if (!match) return null
  const action = match[1]!.toLowerCase() === "approve" ? "approve" : "reject"
  const hint = match[2]?.trim() ? match[2].trim() : null
  return { action, hint }
}

export async function applyInboundApprovalCommand(args: {
  workspaceId: string
  text: string
  respondedBy: string
}): Promise<{ applied: boolean; error?: string }> {
  const command = parseApprovalCommand(args.text)
  if (!command) return { applied: false }

  const pending = await findLatestPendingDeliverableApproval({
    workspaceId: args.workspaceId,
    hint: command.hint,
  })
  if (!pending) {
    log.info("approval command: no pending deliverable", {
      workspaceId: args.workspaceId,
      hint: command.hint,
    })
    return { applied: false, error: "no_pending" }
  }

  const result = await respondToDeliverable({
    workspaceId: args.workspaceId,
    activityLogId: pending.id,
    fileVersionId: pending.fileVersionId ?? undefined,
    action: command.action,
    respondedBy: args.respondedBy,
  })
  if (!result.ok) {
    log.warn("approval command: respond failed", {
      workspaceId: args.workspaceId,
      error: result.error,
    })
    return { applied: false, error: result.error }
  }
  return { applied: true }
}
