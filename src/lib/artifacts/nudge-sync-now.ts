import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { DEFAULT_SYNC_TIMEOUT_MS, trySyncNow } from "@/lib/openclaw/sync-now"

/**
 * After a mission TASK_COMPLETE, nudge the container to upload state now
 * so extract can land FileVersion rows in ~1 min instead of the 5-min tick.
 * Never throws.
 */
export async function nudgeDeliverableSyncNow(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { containerHost: true },
  })
  if (!ws?.containerHost) return
  const outcome = await trySyncNow(ws.containerHost, DEFAULT_SYNC_TIMEOUT_MS, undefined, workspaceId)
  if (!outcome.synced) {
    log.warn("deliverable extract: sync-now nudge did not persist", {
      workspaceId,
      reason: outcome.reason,
    })
  }
}
