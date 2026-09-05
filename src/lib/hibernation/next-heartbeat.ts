import { nextRunsCroner, previousRunCroner } from "@/lib/schedule/croner-parse"
import { cronTzOrUtc } from "@/lib/schedule/cron-tz"

/** Grace after expected fire before Watchtower flags a miss. */

/** Grace after expected fire before Watchtower flags a miss. */
export const HEARTBEAT_MISS_GRACE_MS = 10 * 60 * 1000

/** Ignore miss windows older than this (avoids flagging never-rolled deploy hints). */
export const HEARTBEAT_MISS_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * Grace′ after overlay_boot before WOKE-LATE-NEVER-BEAT flags.
 * Must exceed -10 catch-up fire latency so a successful catch-up beat
 * lands before the detector races it (Phase A: catch-up ≪ 5m).
 */
export const WOKE_LATE_CATCHUP_GRACE_MS = 5 * 60 * 1000

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
        const tz = cronTzOrUtc(extractCronTimezone(job))
        const runs = nextRunsCroner(cronExpr, 1, from, tz)
        const next = runs[0]
        if (!next) continue
        if (!earliest || next < earliest) earliest = next
      } catch {
        // Invalid cron expression - skip
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
        const rawTz =
          job &&
          typeof job === "object" &&
          (job as { schedule?: { tz?: unknown } }).schedule &&
          typeof (job as { schedule: { tz?: unknown } }).schedule.tz === "string"
            ? ((job as { schedule: { tz: string } }).schedule.tz as string)
            : undefined
        const tz = cronTzOrUtc(rawTz)
        const prev = previousRunCroner(cronExpr, now, tz)
        if (!prev) continue
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
 * Window: [expected, expected+grace]. Miss when now ≥ expected+grace and
 * no HEARTBEAT evidence in that window (P2.3: ≤ boundary so grace-edge flags).
 * MUTATION: grace=0 → false-positive when evidence arrives slightly after expected.
 *
 * `scheduleActivatedAt` (latest deployment completedAt): expected fires that
 * predate it are back-projections onto a schedule the container never carried.
 * D6 incident 2026-08-22: first-ever deploy at 14:44:47Z with cron "0 19 * * *"
 * flagged expectedAt=Aug-21T19:00Z one second later - a window 20h before the
 * workspace was first deployed. No container existed to beat; never flag those.
 * MUTATION: drop the guard → every first deploy of a daily cron whose
 * occurrence already passed today instant-flags "Heartbeat missed".
 */
export function decideHeartbeatMissed(args: {
  containerPhase: string
  heartbeatCronExpressions: string | null | undefined
  hasHeartbeatEvidenceInWindow: boolean
  currentFlag: Date | null
  nowMs: number
  graceMs?: number
  scheduleActivatedAt?: Date | null
}): Date | null | undefined {
  // Sticky miss: clear ONLY on beat evidence in-window. Every other early exit
  // is a no-op (undefined) - never clearIfSet during grace / wrong phase / etc.
  // MUTATION: restoring clearIfSet on in-grace → late-wake sticky wiped at 16:01.
  if (args.containerPhase !== "RUNNING" && args.containerPhase !== "WARM") {
    return undefined
  }

  const expected = lastExpectedCronFire(
    args.heartbeatCronExpressions,
    new Date(args.nowMs),
  )
  if (!expected) return undefined

  if (
    args.scheduleActivatedAt &&
    expected.getTime() < args.scheduleActivatedAt.getTime()
  ) {
    return undefined
  }

  const graceMs = args.graceMs ?? HEARTBEAT_MISS_GRACE_MS
  const windowEnd = expected.getTime() + graceMs
  const age = args.nowMs - expected.getTime()
  if (age > HEARTBEAT_MISS_MAX_AGE_MS) return undefined
  // P2.3: strict `<` - at exactly expected+grace the miss flags.
  if (args.nowMs < windowEnd) return undefined
  // Beat evidence in the Watchtower window → clear sticky / no new flag.
  if (args.hasHeartbeatEvidenceInWindow) {
    return args.currentFlag ? null : undefined
  }

  return args.currentFlag ?? new Date(args.nowMs)
}

/**
 * Marker OpenClaw embeds in TASK_START action/detail for cron heartbeat polls.
 * Typed `actionType: HEARTBEAT` is a future overlay (-10) contract; until then
 * detectors + rollers treat this marker as heartbeat evidence.
 */
export const OPENCLAW_HEARTBEAT_POLL_MARKER = "[OpenClaw heartbeat poll]"

export function matchesHeartbeatPollMarker(
  text: string | null | undefined,
): boolean {
  return typeof text === "string" && text.includes(OPENCLAW_HEARTBEAT_POLL_MARKER)
}

/**
 * Missed-wake: HIBERNATED claw whose nextHeartbeatAt is past grace with no boot
 * since that hint. Catches the fixture failure (armed wake never fired).
 * Returns Date to set, null to clear, undefined for no-op.
 *
 * Sticky miss: boot proves wake fired (do not newly flag) but must NOT clear
 * an existing heartbeatMissedAt - only beat evidence clears (activity roller).
 */
export function decideMissedWake(args: {
  workspaceStatus: string
  nextHeartbeatAt: Date | null
  hasBootSinceExpected: boolean
  currentFlag: Date | null
  nowMs: number
  graceMs?: number
}): Date | null | undefined {
  // Sticky miss: this detector never clears (activity roller + beat evidence only).
  // MUTATION: clearIfSet on non-HIBERNATED / in-grace → wipe late-wake sticky.
  if (args.workspaceStatus !== "HIBERNATED") return undefined
  if (!args.nextHeartbeatAt) return undefined

  const graceMs = args.graceMs ?? HEARTBEAT_MISS_GRACE_MS
  const expectedMs = args.nextHeartbeatAt.getTime()
  const age = args.nowMs - expectedMs
  if (age > HEARTBEAT_MISS_MAX_AGE_MS) return undefined
  // P2.3: miss when expected ≤ now − grace (grace-edge inclusive).
  if (expectedMs > args.nowMs - graceMs) return undefined
  if (args.hasBootSinceExpected) {
    // Wake landed - skip new miss flag; keep sticky existing flag.
    return undefined
  }

  return args.currentFlag ?? new Date(args.nowMs)
}

/**
 * WOKE-LATE-NEVER-BEAT: post-cron overlay_boot existed, but no beat evidence
 * arrived by boot+grace′. Closes the Phase A blind spot where missed-wake
 * no-ops on boot and Watchtower often misses a short RUNNING window.
 *
 * Returns Date to set, undefined for no-op. Never clears (activity roller).
 * MUTATION: treating overlay_boot as beat evidence → silent 07-24 class → fail.
 */
export function decideWokeLateNeverBeat(args: {
  expectedAt: Date | null
  /** First overlay_boot at or after expected (post-cron wake). */
  bootAt: Date | null
  /** True when beat evidence exists with timestamp in [expected, boot+grace′]. */
  hasBeatEvidenceByDeadline: boolean
  currentFlag: Date | null
  nowMs: number
  graceMs?: number
  /** Same activation guard as decideHeartbeatMissed: a deploy boot always
   * postdates a back-projected expected fire, so this detector flags fresh
   * deploys too without it. */
  scheduleActivatedAt?: Date | null
}): Date | undefined {
  if (!args.expectedAt || !args.bootAt) return undefined
  if (
    args.scheduleActivatedAt &&
    args.expectedAt.getTime() < args.scheduleActivatedAt.getTime()
  ) {
    return undefined
  }

  const expectedMs = args.expectedAt.getTime()
  const bootMs = args.bootAt.getTime()
  // Pre-cron boot is Watchtower's problem, not this detector.
  if (bootMs < expectedMs) return undefined

  const age = args.nowMs - expectedMs
  if (age < 0 || age > HEARTBEAT_MISS_MAX_AGE_MS) return undefined

  const graceMs = args.graceMs ?? WOKE_LATE_CATCHUP_GRACE_MS
  const deadlineMs = bootMs + graceMs
  // Still inside catch-up window - do not race -10.
  if (args.nowMs < deadlineMs) return undefined

  if (args.hasBeatEvidenceByDeadline) return undefined

  // Sticky: keep existing flag; only newly set when unset.
  return args.currentFlag ?? new Date(args.nowMs)
}

export function isHeartbeatShapedActivity(event: {
  type: string
  metadata?: Record<string, unknown>
  action?: string | null
  detail?: string | null
}): boolean {
  if (event.type === "HEARTBEAT") return true
  if (event.type === "TASK_START" && event.metadata?.eventKind === "overlay_boot") {
    return true
  }
  if (
    event.type === "TASK_START" &&
    (matchesHeartbeatPollMarker(event.action) ||
      matchesHeartbeatPollMarker(event.detail))
  ) {
    return true
  }
  return false
}

/**
 * Beat evidence that may clear sticky heartbeatMissedAt.
 * HEARTBEAT typed or OpenClaw poll-marker - NEVER overlay_boot / wake alone.
 * MUTATION: treating overlay_boot as beat evidence → clear-on-boot → fail.
 */
export function isHeartbeatBeatEvidence(event: {
  type: string
  metadata?: Record<string, unknown>
  action?: string | null
  detail?: string | null
}): boolean {
  if (event.type === "HEARTBEAT") return true
  if (
    event.type === "TASK_START" &&
    (matchesHeartbeatPollMarker(event.action) ||
      matchesHeartbeatPollMarker(event.detail))
  ) {
    return true
  }
  return false
}

/** Prisma OR fragment: HEARTBEAT typed event OR poll-marker TASK_START. */
export function heartbeatEvidenceOrClause(): Array<
  | { actionType: "HEARTBEAT" }
  | {
      actionType: "TASK_START"
      OR: Array<
        | { action: { contains: string } }
        | { detail: { contains: string } }
      >
    }
> {
  return [
    { actionType: "HEARTBEAT" },
    {
      actionType: "TASK_START",
      OR: [
        { action: { contains: OPENCLAW_HEARTBEAT_POLL_MARKER } },
        { detail: { contains: OPENCLAW_HEARTBEAT_POLL_MARKER } },
      ],
    },
  ]
}
