import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

export const CHAT_SEND_REJECTED_EVENT_KIND = "chat_send_rejected"
export const CHAT_SEND_REJECTED_ACTION = "Chat send rejected mid-boot"

/**
 * Dashboard chat success writes no ActivityLog (container hook owns that row).
 * Rejected sends vanish unless we ledger them here - fire-claw 11:36Z during
 * overlay boot had no MESSAGE_SENT and no reject row.
 */
export async function ledgerChatSendRejected(args: {
  workspaceId: string
  reason: string
  detail?: string
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: CHAT_SEND_REJECTED_ACTION,
        actionType: "ERROR",
        detail: args.detail ?? args.reason,
        metadata: JSON.stringify({
          eventKind: CHAT_SEND_REJECTED_EVENT_KIND,
          reason: args.reason,
        }),
      },
    })
  } catch (err) {
    log.error("chat: failed to ledger rejected send", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
