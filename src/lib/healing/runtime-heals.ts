import { after } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import type { HealConditionId } from "@/lib/healing/conditions"
import {
  AUTO_REDEPLOY_CONDITIONS,
  AUTO_REDEPLOY_IDLE_MS,
  evaluateAutoRedeployGuards,
  evaluateCrashRestartGuards,
} from "@/lib/healing/guards"
import { HEAL_ATTEMPT_EVENT_KIND, ledgerHealAttempt } from "@/lib/healing/ledger"
import { loadInFlightWork } from "@/lib/hibernation/mission-idle"
import { redeployWorkspace, restartContainer } from "@/lib/openclaw/deployer"
import { DEFAULT_SYNC_TIMEOUT_MS, trySyncNow } from "@/lib/openclaw/sync-now"

export type HealthHealFamily = "auto-redeploy" | "crash-restart" | "heartbeat-rearm"

export type HealthHealPlan = {
  condition: HealConditionId
  family: HealthHealFamily
}

export function planHealthRuntimeHeal(input: {
  probeKind: "healthy" | "degraded" | "failure"
  probeReason: string | null
  heartbeatMissedAt: Date | null
  mcpSessionHealthStatus: string | null
  containerPhase: string | null
}): HealthHealPlan | null {
  const phase = input.containerPhase
  const running = phase === "RUNNING" || phase === "WARM"

  if (input.probeKind === "degraded") {
    if (input.probeReason === "bad-token") {
      return { condition: "bad-token", family: "auto-redeploy" }
    }
    if (input.probeReason === "plugin-not-loaded") {
      return { condition: "plugin-not-loaded", family: "auto-redeploy" }
    }
    if (input.probeReason === "plugin-errors" || input.probeReason === "no-agents") {
      return { condition: "probe-degraded", family: "auto-redeploy" }
    }
  }

  if (input.mcpSessionHealthStatus === "DEAD" && running) {
    return { condition: "mcp-session-dead", family: "auto-redeploy" }
  }

  if (input.heartbeatMissedAt && running) {
    return { condition: "heartbeat-missed-running", family: "heartbeat-rearm" }
  }

  if (input.probeKind === "failure" && running) {
    return { condition: "probe-failure", family: "crash-restart" }
  }

  return null
}

export async function countHealAttempts(args: {
  workspaceId: string
  condition: HealConditionId
  since: Date
  excludeBlocked?: boolean
}): Promise<{ count: number; lastAt: Date | null }> {
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId: args.workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: args.since },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: `"condition":"${args.condition}"` } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, metadata: true },
  })
  let list = Array.isArray(rows) ? rows : []
  if (args.excludeBlocked) {
    list = list.filter((row) => {
      try {
        const meta = JSON.parse(row.metadata ?? "{}") as { outcome?: string }
        return meta.outcome !== "blocked"
      } catch {
        return true
      }
    })
  }
  return { count: list.length, lastAt: list[0]?.timestamp ?? null }
}

async function idleMsFor(workspaceId: string, now: Date): Promise<number> {
  const state = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: { lastActiveAt: true },
  })
  const last = state?.lastActiveAt
  if (!last) return AUTO_REDEPLOY_IDLE_MS
  return Math.max(0, now.getTime() - last.getTime())
}

async function syncIfPossible(containerHost: string | null, workspaceId: string): Promise<boolean> {
  if (!containerHost) return false
  const result = await trySyncNow(containerHost, DEFAULT_SYNC_TIMEOUT_MS, undefined, workspaceId)
  return result.synced
}

export async function executeAutoRedeploy(args: {
  workspaceId: string
  condition: HealConditionId
  containerHost: string | null
}): Promise<"healed" | "blocked" | "exhausted" | "failed"> {
  if (!(AUTO_REDEPLOY_CONDITIONS as readonly string[]).includes(args.condition)) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: args.condition,
      outcome: "blocked",
      detail: "condition not in auto-redeploy family",
    })
    return "blocked"
  }

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const poison = args.condition === "thinking-signature-poison"
  const attempts = await countHealAttempts({
    workspaceId: args.workspaceId,
    condition: args.condition,
    since,
    excludeBlocked: poison,
  })
  const { hasInFlightRuns } = await loadInFlightWork(args.workspaceId, now)
  const idle = poison
    ? AUTO_REDEPLOY_IDLE_MS
    : hasInFlightRuns
      ? 0
      : await idleMsFor(args.workspaceId, now)
  const synced = await syncIfPossible(args.containerHost, args.workspaceId)
  const decision = evaluateAutoRedeployGuards({
    syncSucceeded: synced,
    idleMs: idle,
    attemptsInWindow: attempts.count,
    lastAttemptAt: attempts.lastAt,
    now,
    skipIdle: poison,
  })

  if (!decision.allowed) {
    const outcome = decision.escalateOwner ? "exhausted" : "blocked"
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: args.condition,
      outcome,
      detail: `blockedBy=${decision.blockedBy}`,
    })
    if (decision.escalateOwner) {
      await sendOwnerAlert({
        alertKey: "heal-exhausted",
        title: `Auto-redeploy cap: ${args.condition}`,
        detail: `workspace ${args.workspaceId} hit ${attempts.count}/24h`,
        workspaceId: args.workspaceId,
      })
    }
    return outcome
  }

  try {
    await redeployWorkspace(args.workspaceId)
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: args.condition,
      outcome: "healed",
      detail: "auto-redeploy",
    })
    return "healed"
  } catch (err) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: args.condition,
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    })
    return "failed"
  }
}

export async function executeCrashRestart(args: {
  workspaceId: string
  containerHost: string | null
}): Promise<"healed" | "blocked" | "exhausted" | "failed"> {
  const now = new Date()
  const since = new Date(now.getTime() - 60 * 60 * 1000)
  const attempts = await countHealAttempts({
    workspaceId: args.workspaceId,
    condition: "probe-failure",
    since,
  })
  const decision = evaluateCrashRestartGuards({
    attemptsInHour: attempts.count,
    lastAttemptAt: attempts.lastAt,
    now,
  })
  await syncIfPossible(args.containerHost, args.workspaceId)

  if (!decision.allowed) {
    const outcome = decision.escalateOwner ? "exhausted" : "blocked"
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "probe-failure",
      outcome,
      detail: `blockedBy=${decision.blockedBy}`,
    })
    if (decision.escalateOwner) {
      await sendOwnerAlert({
        alertKey: "heal-exhausted",
        title: "Crash restart cap: probe-failure",
        detail: `workspace ${args.workspaceId} hit ${attempts.count}/h`,
        workspaceId: args.workspaceId,
      })
    }
    return outcome
  }

  try {
    await restartContainer(args.workspaceId)
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "probe-failure",
      outcome: "healed",
      detail: "crash-restart",
    })
    return "healed"
  } catch (err) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "probe-failure",
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    })
    return "failed"
  }
}

export async function executeHeartbeatRearmRestart(args: {
  workspaceId: string
  containerHost: string | null
}): Promise<"healed" | "blocked" | "exhausted" | "failed"> {
  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const attempts = await countHealAttempts({
    workspaceId: args.workspaceId,
    condition: "heartbeat-missed-running",
    since,
  })
  const { hasInFlightRuns } = await loadInFlightWork(args.workspaceId, now)
  const idle = hasInFlightRuns ? 0 : await idleMsFor(args.workspaceId, now)
  const synced = await syncIfPossible(args.containerHost, args.workspaceId)
  const decision = evaluateAutoRedeployGuards({
    syncSucceeded: synced,
    idleMs: idle,
    attemptsInWindow: attempts.count,
    lastAttemptAt: attempts.lastAt,
    now,
  })

  if (!decision.allowed) {
    const outcome = decision.escalateOwner ? "exhausted" : "blocked"
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "heartbeat-missed-running",
      outcome,
      detail: `blockedBy=${decision.blockedBy}`,
    })
    if (decision.escalateOwner) {
      await sendOwnerAlert({
        alertKey: "heal-exhausted",
        title: "Heartbeat re-arm restart cap",
        detail: `workspace ${args.workspaceId} hit ${attempts.count}/24h`,
        workspaceId: args.workspaceId,
      })
    }
    return outcome
  }

  try {
    const state = await prisma.containerState.findUnique({
      where: { workspaceId: args.workspaceId },
      select: { heartbeatCronExpressions: true, heartbeatInterval: true },
    })
    const { computeNextHeartbeatAt } = await import("@/lib/hibernation/next-heartbeat")
    const next = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: state?.heartbeatCronExpressions,
      heartbeatIntervalMs: state?.heartbeatInterval,
    })
    await prisma.containerState.update({
      where: { workspaceId: args.workspaceId },
      data: { nextHeartbeatAt: next },
    })
    await restartContainer(args.workspaceId)
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "heartbeat-missed-running",
      outcome: "healed",
      detail: "re-arm then restart",
    })
    return "healed"
  } catch (err) {
    await ledgerHealAttempt({
      workspaceId: args.workspaceId,
      condition: "heartbeat-missed-running",
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    })
    return "failed"
  }
}

export function scheduleHealthRuntimeHeal(args: {
  workspaceId: string
  containerHost: string | null
  plan: HealthHealPlan
}): void {
  after(() => {
    const run =
      args.plan.family === "crash-restart"
        ? executeCrashRestart({
            workspaceId: args.workspaceId,
            containerHost: args.containerHost,
          })
        : args.plan.family === "heartbeat-rearm"
          ? executeHeartbeatRearmRestart({
              workspaceId: args.workspaceId,
              containerHost: args.containerHost,
            })
          : executeAutoRedeploy({
              workspaceId: args.workspaceId,
              condition: args.plan.condition,
              containerHost: args.containerHost,
            })
    return run.catch((err) => {
      log.error("runtime-heal failed", {
        workspaceId: args.workspaceId,
        condition: args.plan.condition,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
}

export function scheduleThinkingSignatureHeal(workspaceId: string, containerHost: string | null): void {
  void executeAutoRedeploy({
    workspaceId,
    condition: "thinking-signature-poison",
    containerHost,
  }).catch((err) => {
    log.error("thinking-signature auto-redeploy failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}
