import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendCustomerNudge, resolveCustomerNudge } from "@/lib/alerts/customer-nudge"
import { ledgerHealAttempt } from "@/lib/healing/ledger"
import { syncThenRemoveDeployment } from "@/lib/openclaw/deployer"

export const SPEND_LIMIT_ENFORCED_EVENT_KIND = "spend_limit_enforced"

export function spendLimitReached(args: {
  currentMonthApiCost: number
  apiSpendLimit: number
}): boolean {
  if (!(args.apiSpendLimit > 0)) return false
  return args.currentMonthApiCost >= args.apiSpendLimit
}

export function shouldShowSpendLimitBanner(args: {
  spendReached: boolean
  workspaceStatus: string
  enforced: boolean
}): boolean {
  return args.spendReached && args.enforced && args.workspaceStatus === "PAUSED"
}

export type SpendLimitPlan =
  | { action: "noop" }
  | { action: "enforce" }
  | { action: "resolve" }

export function planSpendLimit(args: {
  reached: boolean
  alreadyEnforced: boolean
}): SpendLimitPlan {
  if (args.reached && !args.alreadyEnforced) return { action: "enforce" }
  if (!args.reached && args.alreadyEnforced) return { action: "resolve" }
  return { action: "noop" }
}

async function hasOpenEnforcement(workspaceId: string): Promise<boolean> {
  const last = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      metadata: { contains: `"eventKind":"${SPEND_LIMIT_ENFORCED_EVENT_KIND}"` },
    },
    orderBy: { timestamp: "desc" },
    select: { metadata: true },
  })
  if (!last?.metadata) return false
  try {
    const meta = JSON.parse(last.metadata) as { open?: boolean }
    return meta.open === true
  } catch {
    return false
  }
}

async function ledgerEnforcement(args: {
  workspaceId: string
  open: boolean
  detail: string
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      action: args.open ? "Spend limit: paused" : "Spend limit: cleared",
      detail: args.detail,
      actionType: "SYSTEM",
      timestamp: new Date(),
      metadata: JSON.stringify({
        eventKind: SPEND_LIMIT_ENFORCED_EVENT_KIND,
        open: args.open,
      }),
    },
  })
}

/**
 * Limit reached → sync → pause (stop deployment, never destroy the service)
 * → customer nudge. Resolve when cost drops below the limit (reset / raise).
 */
export async function applyWorkspaceApiCost(args: {
  workspaceId: string
  delta: number
}): Promise<{ enforced: boolean; resolved: boolean }> {
  if (!(args.delta > 0) || !Number.isFinite(args.delta)) {
    return { enforced: false, resolved: false }
  }

  const workspace = await prisma.workspace.update({
    where: { id: args.workspaceId },
    data: { currentMonthApiCost: { increment: args.delta } },
    select: {
      id: true,
      status: true,
      currentMonthApiCost: true,
      apiSpendLimit: true,
    },
  })

  return enforceSpendLimit({
    workspaceId: workspace.id,
    currentMonthApiCost: workspace.currentMonthApiCost,
    apiSpendLimit: workspace.apiSpendLimit,
    status: workspace.status,
  })
}

export async function enforceSpendLimit(args: {
  workspaceId: string
  currentMonthApiCost: number
  apiSpendLimit: number
  status: string
}): Promise<{ enforced: boolean; resolved: boolean }> {
  const reached = spendLimitReached(args)
  const alreadyEnforced = await hasOpenEnforcement(args.workspaceId)
  const plan = planSpendLimit({ reached, alreadyEnforced })

  if (plan.action === "noop") {
    return { enforced: false, resolved: false }
  }

  if (plan.action === "resolve") {
    await ledgerEnforcement({
      workspaceId: args.workspaceId,
      open: false,
      detail: "limit reset or raised",
    })
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "spend-limit-100",
      outcome: "cleared",
      detail: "spend below limit",
    })
    await resolveCustomerNudge({
      workspaceId: args.workspaceId,
      condition: "spend-limit-100",
    })
    return { enforced: false, resolved: true }
  }

  if (args.status === "RUNNING" || args.status === "WAKING" || args.status === "ERROR") {
    try {
      const teardown = await syncThenRemoveDeployment(args.workspaceId, {
        destroyPolicy: "refuse-unsafe",
      })
      if (!teardown.destroyed) {
        log.warn("spend-limit: sync refused teardown; still pausing workspace row", {
          workspaceId: args.workspaceId,
          reason: teardown.reason,
        })
      }
    } catch (err) {
      log.error("spend-limit: syncThenRemoveDeployment failed", {
        workspaceId: args.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: args.workspaceId },
      data: { status: "PAUSED" },
    }),
    prisma.containerState.updateMany({
      where: { workspaceId: args.workspaceId },
      data: { containerPhase: "STOPPED" },
    }),
  ])

  await ledgerEnforcement({
    workspaceId: args.workspaceId,
    open: true,
    detail: "sync then pause; service kept",
  })
  await ledgerHealAttempt({
    workspaceId: args.workspaceId,
    condition: "spend-limit-100",
    outcome: "exhausted",
    detail: "limit reached; paused",
  })
  await sendCustomerNudge({
    workspaceId: args.workspaceId,
    condition: "spend-limit-100",
  })
  return { enforced: true, resolved: false }
}

export async function maybeResolveSpendLimitAfterLimitChange(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { currentMonthApiCost: true, apiSpendLimit: true, status: true },
  })
  if (!workspace) return
  await enforceSpendLimit({
    workspaceId,
    currentMonthApiCost: workspace.currentMonthApiCost,
    apiSpendLimit: workspace.apiSpendLimit,
    status: workspace.status,
  })
}
