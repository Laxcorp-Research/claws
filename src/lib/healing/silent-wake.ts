import { after } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import { sendCriticalAlert } from "@/lib/alerts/critical-alert-push"
import { evaluateSilentWakeGuards } from "@/lib/healing/guards"
import { HEAL_ATTEMPT_EVENT_KIND, ledgerHealAttempt } from "@/lib/healing/ledger"
import { wakeWorkspace } from "@/lib/hibernation/manager"
import { isRailwayDomainCapError } from "@/lib/openclaw/service-domain"
import { ensureServiceDomain } from "@/lib/openclaw/railway-client"
import {
  canWakeHibernatedWorkspace,
  WAKE_ON_CHANNEL_ENTITLEMENT_DENIED,
} from "@/lib/trial/wake-entitlement"

export const SILENT_WAKE_SCHEDULER_STATUSES = ["HIBERNATED", "ERROR"] as const

/** One heartbeat window when interval is unknown (twitter 4h jobs). */
export const DEFAULT_SILENT_WAKE_REALERT_MS = 4 * 60 * 60 * 1000

export type SilentWakeTrigger =
  | "missed-wake"
  | "wake-failed"
  | "entitlement-denied"
  | "stuck-hibernated"

export function missedWakeWorkspaceWhere(graceCutoff: Date) {
  return {
    status: { in: [...SILENT_WAKE_SCHEDULER_STATUSES] },
    containerState: {
      nextHeartbeatAt: { lte: graceCutoff },
    },
  }
}

export function isSilentWakeSchedulerStatus(status: string): boolean {
  return status === "HIBERNATED" || status === "ERROR" || status === "WAKING"
}

export function silentWakeRealertMs(heartbeatIntervalMs: number | null | undefined): number {
  if (
    typeof heartbeatIntervalMs === "number" &&
    Number.isFinite(heartbeatIntervalMs) &&
    heartbeatIntervalMs > 0
  ) {
    return heartbeatIntervalMs
  }
  return DEFAULT_SILENT_WAKE_REALERT_MS
}

export function shouldOwnerAlertSilentWake(args: {
  lastOwnerAlertAt: Date | null
  now: Date
  realertMs: number
}): boolean {
  if (!args.lastOwnerAlertAt) return true
  return args.now.getTime() - args.lastOwnerAlertAt.getTime() >= args.realertMs
}

async function countSilentWakeAttempts(args: {
  workspaceId: string
  since: Date
}): Promise<{ count: number; lastAt: Date | null }> {
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId: args.workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: args.since },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: '"condition":"silent-wake"' } },
        { NOT: { detail: { startsWith: "owner-alert" } } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  const list = Array.isArray(rows) ? rows : []
  return { count: list.length, lastAt: list[0]?.timestamp ?? null }
}

async function lastSilentWakeOwnerAlertAt(workspaceId: string): Promise<Date | null> {
  const row = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      AND: [
        { metadata: { contains: '"condition":"silent-wake"' } },
        { detail: { startsWith: "owner-alert" } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  return row?.timestamp ?? null
}

async function emitOwnerAlert(args: {
  workspaceId: string
  title: string
  detail: string
}): Promise<void> {
  await sendOwnerAlert({
    alertKey: "silent-wake",
    title: args.title,
    detail: args.detail,
    workspaceId: args.workspaceId,
  })
  await ledgerHealAttempt({
    workspaceId: args.workspaceId,
    condition: "silent-wake",
    outcome: "failed",
    detail: `owner-alert:${args.detail}`,
  })
}

export async function executeSilentWakeHeal(args: {
  workspaceId: string
  trigger: SilentWakeTrigger
  now?: Date
}): Promise<"healed" | "blocked" | "exhausted" | "failed" | "nudged"> {
  const now = args.now ?? new Date()
  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    include: {
      containerState: true,
      user: {
        select: {
          trialUsed: true,
          trialStartedAt: true,
          trialEndsAt: true,
          hasActiveSubscription: true,
        },
      },
    },
  })

  if (!workspace) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "silent-wake",
      outcome: "skipped",
      detail: "workspace-not-found",
    })
    return "blocked"
  }

  const entitlement = workspace.user
    ? canWakeHibernatedWorkspace(workspace.user)
    : { allowed: false as const, reason: "owner_missing", needsSubscription: true }

  const realertMs = silentWakeRealertMs(workspace.containerState?.heartbeatInterval ?? null)
  const lastOwnerAlertAt = await lastSilentWakeOwnerAlertAt(args.workspaceId)
  const ownerDue = shouldOwnerAlertSilentWake({ lastOwnerAlertAt, now, realertMs })

  if (!entitlement.allowed || args.trigger === "entitlement-denied") {
    if (ownerDue) {
      await emitOwnerAlert({
        workspaceId: args.workspaceId,
        title: "Silent claw: entitlement denied",
        detail: `workspace ${args.workspaceId} trigger=${args.trigger} reason=${entitlement.reason}`,
      })
    }
    if (entitlement.needsSubscription) {
      await sendCriticalAlert({
        workspaceId: args.workspaceId,
        alertKey: "heartbeat-missed",
        detail: WAKE_ON_CHANNEL_ENTITLEMENT_DENIED,
      }).catch((err) => {
        log.error("silent-wake: customer nudge failed", {
          workspaceId: args.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "silent-wake",
      outcome: "skipped",
      detail: `entitlement:${entitlement.reason}`,
    })
    return "nudged"
  }

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const attempts = await countSilentWakeAttempts({
    workspaceId: args.workspaceId,
    since,
  })
  const decision = evaluateSilentWakeGuards({
    attemptsInWindow: attempts.count,
    lastAttemptAt: attempts.lastAt,
    now,
  })

  if (!decision.allowed) {
    const outcome = decision.escalateOwner ? "exhausted" : "blocked"
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "silent-wake",
      outcome,
      detail: `blockedBy=${decision.blockedBy} trigger=${args.trigger}`,
    })
    if (decision.escalateOwner && ownerDue) {
      await emitOwnerAlert({
        workspaceId: args.workspaceId,
        title: "Silent-wake heal cap",
        detail: `workspace ${args.workspaceId} hit ${attempts.count}/24h trigger=${args.trigger}`,
      })
    }
    return outcome
  }

  if (ownerDue) {
    await emitOwnerAlert({
      workspaceId: args.workspaceId,
      title: "Silent claw: scheduled wake failed",
      detail: `workspace ${args.workspaceId} trigger=${args.trigger} nextHeartbeatAt=${workspace.containerState?.nextHeartbeatAt?.toISOString() ?? "null"}`,
    })
  }

  if (workspace.containerId) {
    try {
      await ensureServiceDomain(workspace.containerId, workspace.containerHost)
    } catch (err) {
      log.warn("silent-wake: domain prune failed", {
        workspaceId: args.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    await wakeWorkspace(args.workspaceId)
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "silent-wake",
      outcome: "healed",
      detail: `trigger=${args.trigger}`,
    })
    return "healed"
  } catch (err) {
    if (isRailwayDomainCapError(err) && workspace.containerId) {
      try {
        await ensureServiceDomain(workspace.containerId, workspace.containerHost)
        await wakeWorkspace(args.workspaceId)
        await ledgerHealAttempt({
          workspaceId: args.workspaceId,
          condition: "silent-wake",
          outcome: "healed",
          detail: `trigger=${args.trigger} domain-cap-retry`,
        })
        return "healed"
      } catch (retryErr) {
        await ledgerHealAttempt({
          workspaceId: args.workspaceId,
          condition: "silent-wake",
          outcome: "failed",
          detail: retryErr instanceof Error ? retryErr.message : String(retryErr),
        })
        return "failed"
      }
    }
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "silent-wake",
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    })
    return "failed"
  }
}

export function scheduleSilentWakeHeal(args: {
  workspaceId: string
  trigger: SilentWakeTrigger
}): void {
  after(() =>
    executeSilentWakeHeal(args).catch((err) => {
      log.error("silent-wake heal failed", {
        workspaceId: args.workspaceId,
        trigger: args.trigger,
        error: err instanceof Error ? err.message : String(err),
      })
    }),
  )
}
