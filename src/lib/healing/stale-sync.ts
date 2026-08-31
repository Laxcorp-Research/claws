import type { WorkspaceStatus } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { getHealPolicy } from "@/lib/healing/registry"
import { ledgerHealAttempt } from "@/lib/healing/ledger"
import { DEFAULT_SYNC_TIMEOUT_MS, trySyncNow } from "@/lib/openclaw/sync-now"

export const PARKED_STALE_SYNC_STATUSES: WorkspaceStatus[] = [
  "HIBERNATED",
  "PROVISIONING_QUEUED",
  "STOPPED",
]

export function isParkedForStaleSync(status: WorkspaceStatus): boolean {
  return (PARKED_STALE_SYNC_STATUSES as readonly string[]).includes(status)
}

export type StaleSyncHealDecision =
  | { action: "clear" }
  | { action: "retry" }
  | { action: "alert" }
  | { action: "noop" }

/**
 * Pure planner. consecutive is the post-probe cry-wolf counter (flag at 2).
 * Heal retries occupy consecutive 2,3,4. Alert when consecutive >= 2+retries.
 */
export function decideStaleSyncHeal(args: {
  parked: boolean
  flagSet: boolean
  consecutive: number
  retries: number
}): StaleSyncHealDecision {
  if (args.parked && args.flagSet) return { action: "clear" }
  if (args.parked) return { action: "noop" }
  if (!args.flagSet) return { action: "noop" }
  const exhaustAt = 2 + args.retries
  if (args.consecutive >= exhaustAt) return { action: "alert" }
  return { action: "retry" }
}

export async function clearParkedStaleSyncFlags(): Promise<number> {
  const rows = await prisma.workspace.findMany({
    where: {
      stateSyncStaleDetectedAt: { not: null },
      status: { in: PARKED_STALE_SYNC_STATUSES },
    },
    select: { id: true, status: true },
  })
  const parked = rows.filter((r) => isParkedForStaleSync(r.status))
  if (parked.length === 0) return 0

  await prisma.workspace.updateMany({
    where: { id: { in: parked.map((r) => r.id) } },
    data: { stateSyncStaleDetectedAt: null, stateSyncStaleConsecutive: 0 },
  })
  for (const row of parked) {
    await ledgerHealAttempt({
      workspaceId: row.id,
      condition: "state-sync-stale",
      outcome: "cleared",
      detail: `silent clear; status=${row.status}`,
    })
  }
  return parked.length
}

export type RunningStaleSyncResult = {
  cleared: boolean
  alert: boolean
  synced: boolean
}

export async function healRunningStaleSync(args: {
  workspaceId: string
  containerHost: string | null
  consecutive: number
}): Promise<RunningStaleSyncResult> {
  const retries = getHealPolicy("state-sync-stale").retries
  const decision = decideStaleSyncHeal({
    parked: false,
    flagSet: true,
    consecutive: args.consecutive,
    retries,
  })

  if (decision.action === "alert") {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "state-sync-stale",
      outcome: "exhausted",
      detail: `trySyncNow failed ${retries} time(s)`,
    })
    return { cleared: false, alert: true, synced: false }
  }

  if (!args.containerHost) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "state-sync-stale",
      outcome: "failed",
      detail: "no-container-host",
    })
    return { cleared: false, alert: false, synced: false }
  }

  const outcome = await trySyncNow(args.containerHost, DEFAULT_SYNC_TIMEOUT_MS)
  if (outcome.synced) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "state-sync-stale",
      outcome: "healed",
      detail: "trySyncNow persisted",
    })
    return { cleared: true, alert: false, synced: true }
  }

  await ledgerHealAttempt({
    workspaceId: args.workspaceId,
    condition: "state-sync-stale",
    outcome: "failed",
    detail: outcome.reason,
  })
  return { cleared: false, alert: false, synced: false }
}
