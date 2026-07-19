import { CronExpressionParser } from "cron-parser"

/** Grace after expected fire before Watchtower flags a miss. */
export const HEARTBEAT_MISS_GRACE_MS = 10 * 60 * 1000

/** Ignore miss windows older than this (avoids flagging never-rolled deploy hints). */
export const HEARTBEAT_MISS_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * Pulls the cron expression string out of a job entry. Handles the
 * verified OpenClaw shape `{ schedule: { kind: 'cron', expr } }` plus a
 * couple of legacy/string fallbacks defensively. Non-cron schedule kinds
 * (`every`, `at`) intentionally return null because they aren't cron-parseable.
 */
export function extractCronExpression(job: unknown): string | null {
  if (!job || typeof job !== "object") return null
  const obj = job as { schedule?: unknown; cron?: unknown }
  if (obj.schedule && typeof obj.schedule === "object") {
    const sched = obj.schedule as { kind?: unknown; expr?: unknown }
    if (sched.kind === "cron" && typeof sched.expr === "string" && sched.expr.length > 0) {
      return sched.expr
    }
    return null
  }
  if (typeof obj.schedule === "string" && obj.schedule.length > 0) return obj.schedule
  if (typeof obj.cron === "string" && obj.cron.length > 0) return obj.cron
  return null
}

function extractCronTimezone(job: unknown): string | null {
  if (!job || typeof job !== "object") return null
  const obj = job as { schedule?: unknown }
  if (obj.schedule && typeof obj.schedule === "object") {
    const sched = obj.schedule as { tz?: unknown }
    if (typeof sched.tz === "string" && sched.tz.length > 0) return sched.tz
  }
  return null
}

/**
 * Earliest next cron fire from stored cron/jobs.json (null for interval-only).
 * `from` anchors the parser (defaults to now) so rolling after a heartbeat
 * fire advances from the fire timestamp, not wall clock alone.
 */
export function calculateNextHeartbeat(
  cronJobsJson: string | null | undefined,
  from: Date = new Date(),
): Date | null {
  if (!cronJobsJson || cronJobsJson === "[]") return null
  try {
    const jobs = JSON.parse(cronJobsJson)
    if (!Array.isArray(jobs) || jobs.length === 0) return null
    let earliest: Date | null = null
    for (const job of jobs) {
      const cronExpr = extractCronExpression(job)
      if (!cronExpr) continue
      try {
        const tz = extractCronTimezone(job)
        const next = CronExpressionParser.parse(cronExpr, {
          currentDate: from,
          ...(tz ? { tz } : {}),
        })
          .next()
          .toDate()
        if (!earliest || next < earliest) earliest = next
      } catch {
        // Invalid cron expression — skip
      }
    }
    return earliest
  } catch {
    return null
  }
}

/**
 * Parse `agents.defaults.heartbeat.every` ("1h" / "6h" / "12h") → ms.
 * Used at deploy to populate ContainerState.heartbeatInterval.
 */
export function parseHeartbeatEveryToMs(every: string | null | undefined): number | null {
  if (typeof every !== "string" || every.length === 0) return null
  const m = every.trim().match(/^(\d+)(ms|s|m|h|d)$/)
  if (!m) return null
  const value = parseInt(m[1], 10)
  if (!Number.isFinite(value) || value <= 0) return null
  switch (m[2]) {
    case "ms":
      return value
    case "s":
      return value * 1000
    case "m":
      return value * 60 * 1000
    case "h":
      return value * 60 * 60 * 1000
    case "d":
      return value * 24 * 60 * 60 * 1000
    default:
      return null
  }
}

/** Extract interval ms from generated openclaw.json string. */
export function extractHeartbeatIntervalMsFromOpenclawJson(
  openclawJson: string | null | undefined,
): number | null {
  if (!openclawJson) return null
  try {
    const cfg = JSON.parse(openclawJson) as {
      agents?: { defaults?: { heartbeat?: { every?: unknown } } }
    }
    const every = cfg.agents?.defaults?.heartbeat?.every
    return typeof every === "string" ? parseHeartbeatEveryToMs(every) : null
  } catch {
    return null
  }
}

/**
 * Rolling wake hint: earliest of (next cron fire, now+interval).
 * Interval claws get a non-null hint so hibernation auto-wake covers them.
 */
export function computeNextHeartbeatAt(args: {
  now: Date
  heartbeatCronExpressions: string | null | undefined
  heartbeatIntervalMs: number | null | undefined
}): Date | null {
  const fromCron = calculateNextHeartbeat(args.heartbeatCronExpressions, args.now)
  const intervalMs =
    typeof args.heartbeatIntervalMs === "number" &&
    Number.isFinite(args.heartbeatIntervalMs) &&
    args.heartbeatIntervalMs > 0
      ? args.heartbeatIntervalMs
      : null
  const fromInterval =
    intervalMs !== null ? new Date(args.now.getTime() + intervalMs) : null

  if (fromCron && fromInterval) {
    return fromCron.getTime() <= fromInterval.getTime() ? fromCron : fromInterval
  }
  return fromCron ?? fromInterval
}

/**
 * Most recent expected cron fire at or before `now` (max of prev() across jobs).
 * Null when no cron-shaped jobs (interval-only / empty).
 */
export function lastExpectedCronFire(
  heartbeatCronExpressions: string | null | undefined,
  now: Date,
): Date | null {
  if (!heartbeatCronExpressions || heartbeatCronExpressions === "[]") return null
  try {
    const jobs = JSON.parse(heartbeatCronExpressions) as unknown
    if (!Array.isArray(jobs) || jobs.length === 0) return null
    let latest: Date | null = null
    for (const job of jobs) {
      const cronExpr = extractCronExpression(job)
      if (!cronExpr) continue
      try {
        const tz =
          job &&
          typeof job === "object" &&
          (job as { schedule?: { tz?: unknown } }).schedule &&
          typeof (job as { schedule: { tz?: unknown } }).schedule.tz === "string"
            ? ((job as { schedule: { tz: string } }).schedule.tz as string)
            : undefined
        const prev = CronExpressionParser.parse(cronExpr, {
          currentDate: now,
          ...(tz ? { tz } : {}),
        })
          .prev()
          .toDate()
        if (!latest || prev > latest) latest = prev
      } catch {
        // skip invalid
      }
    }
    return latest
  } catch {
    return null
  }
}

/**
 * Watchtower miss decision (distinct from activity-silence).
 * Returns Date to set, null to clear, undefined for no-op.
 *
 * Window: [expected, expected+grace]. Miss when now > expected+grace and
 * no HEARTBEAT evidence in that window. MUTATION: grace=0 → false-positive
 * when evidence arrives slightly after expected.
 */
export function decideHeartbeatMissed(args: {
  containerPhase: string
  heartbeatCronExpressions: string | null | undefined
  hasHeartbeatEvidenceInWindow: boolean
  currentFlag: Date | null
  nowMs: number
  graceMs?: number
}): Date | null | undefined {
  const clearIfSet = args.currentFlag ? null : undefined
  if (args.containerPhase !== "RUNNING" && args.containerPhase !== "WARM") {
    return clearIfSet
  }

  const expected = lastExpectedCronFire(
    args.heartbeatCronExpressions,
    new Date(args.nowMs),
  )
  if (!expected) return clearIfSet

  const graceMs = args.graceMs ?? HEARTBEAT_MISS_GRACE_MS
  const windowEnd = expected.getTime() + graceMs
  const age = args.nowMs - expected.getTime()
  if (age > HEARTBEAT_MISS_MAX_AGE_MS) return clearIfSet
  if (args.nowMs <= windowEnd) return clearIfSet
  if (args.hasHeartbeatEvidenceInWindow) return clearIfSet

  return args.currentFlag ?? new Date(args.nowMs)
}

export function isHeartbeatShapedActivity(event: {
  type: string
  metadata?: Record<string, unknown>
}): boolean {
  if (event.type === "HEARTBEAT") return true
  if (event.type === "TASK_START" && event.metadata?.eventKind === "overlay_boot") {
    return true
  }
  return false
}
