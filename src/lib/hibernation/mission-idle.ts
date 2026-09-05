import { prisma } from "@/lib/db"
import {
  calculateNextHeartbeat,
  isHeartbeatShapedActivity,
  lastExpectedCronFire,
  matchesHeartbeatPollMarker,
} from "@/lib/hibernation/next-heartbeat"

/** Keep the claw up this long after a scheduled window fire. */
export const MISSION_WINDOW_MAX_MS = 45 * 60 * 1000

/** Subagent stall budget advertised in WAVE-0 window scripts. */
export const SUBAGENT_STALL_MAX_MS = 20 * 60 * 1000

export type MissionIdleSignals = {
  chatIdle: boolean
  hasInFlightRuns: boolean
  insideMissionWindow: boolean
}

/**
 * Hibernate only when all three are true: no human activity, no in-flight
 * runs/subagents, and no active mission window.
 * MUTATION: chat-only idle with active subagents → hibernates → fail.
 */
export function decideMissionAwareHibernate(signals: MissionIdleSignals): boolean {
  return signals.chatIdle && !signals.hasInFlightRuns && !signals.insideMissionWindow
}

export function isInsideMissionWindow(args: {
  heartbeatCronExpressions: string | null | undefined
  now: Date
  maxMs?: number
}): boolean {
  const last = lastExpectedCronFire(args.heartbeatCronExpressions, args.now)
  if (!last) return false
  const elapsed = args.now.getTime() - last.getTime()
  if (elapsed < 0) return false
  const maxMs = args.maxMs ?? MISSION_WINDOW_MAX_MS
  if (elapsed >= maxMs) return false
  const next = calculateNextHeartbeat(args.heartbeatCronExpressions, last)
  if (next && args.now.getTime() >= next.getTime()) return false
  return true
}

export function countOpenTasks(
  events: Array<{
    type: string
    action?: string | null
    detail?: string | null
    metadata?: Record<string, unknown>
  }>,
): number {
  let open = 0
  for (const ev of events) {
    if (ev.type === "TASK_START") {
      if (isHeartbeatShapedActivity(ev)) continue
      if (ev.metadata?.eventKind === "overlay_boot") continue
      if (matchesHeartbeatPollMarker(ev.action) || matchesHeartbeatPollMarker(ev.detail)) {
        continue
      }
      open += 1
      continue
    }
    if (ev.type === "TASK_COMPLETE" || ev.type === "TASK_FAILED") {
      open = Math.max(0, open - 1)
    }
  }
  return open
}

export function hasRecentSubagentSpawn(
  skills: Array<{ action?: string | null; timestamp: Date }>,
  now: Date,
  windowMs = 10 * 60 * 1000,
): boolean {
  const cutoff = now.getTime() - windowMs
  return skills.some((row) => {
    if (row.timestamp.getTime() < cutoff) return false
    const action = row.action ?? ""
    return action.includes("sessions_spawn")
  })
}

export async function loadInFlightWork(
  workspaceId: string,
  now: Date,
): Promise<{ hasInFlightRuns: boolean; openTasks: number }> {
  const since = new Date(now.getTime() - MISSION_WINDOW_MAX_MS)
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId,
      timestamp: { gte: since },
      actionType: { in: ["TASK_START", "TASK_COMPLETE", "TASK_FAILED", "SKILL_INVOKED"] },
    },
    orderBy: { timestamp: "asc" },
    select: { actionType: true, action: true, detail: true, metadata: true, timestamp: true },
  })
  const list = Array.isArray(rows) ? rows : []
  const tasks = list
    .filter((r) => r.actionType !== "SKILL_INVOKED")
    .map((r) => {
      let metadata: Record<string, unknown> | undefined
      if (typeof r.metadata === "string") {
        try {
          metadata = JSON.parse(r.metadata) as Record<string, unknown>
        } catch {
          metadata = undefined
        }
      }
      return {
        type: r.actionType,
        action: r.action,
        detail: r.detail,
        metadata,
      }
    })
  const openTasks = countOpenTasks(tasks)
  const spawned = hasRecentSubagentSpawn(
    list
      .filter((r) => r.actionType === "SKILL_INVOKED")
      .map((r) => ({ action: r.action, timestamp: r.timestamp })),
    now,
  )
  return { hasInFlightRuns: openTasks > 0 || spawned, openTasks }
}

export async function shouldHibernateMissionAware(args: {
  workspaceId: string
  heartbeatCronExpressions: string | null | undefined
  now: Date
}): Promise<boolean> {
  const insideMissionWindow = isInsideMissionWindow({
    heartbeatCronExpressions: args.heartbeatCronExpressions,
    now: args.now,
  })
  const { hasInFlightRuns } = await loadInFlightWork(args.workspaceId, args.now)
  // Prisma sleep predicates already enforced chat-idle / channels / imminent.
  return decideMissionAwareHibernate({
    chatIdle: true,
    hasInFlightRuns,
    insideMissionWindow,
  })
}
