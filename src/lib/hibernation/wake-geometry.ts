/**
 * P2.3 wake geometry — lead floor + past-due eligibility.
 *
 * Staging hibernation cron is GH Actions every-5-minutes (gaps + jitter). A lead
 * narrower than observed inter-tick gaps leaves the fixture ineligible on the
 * tick before the window, then only selects past-due after the beat (late wake
 * / missed_wake). Evidence Aug-10/11: gaps 22–30m with an 8m floor → 16:00 and
 * 08:00 beats missed. Lead must cover observed gaps, not just the nominal 5m
 * cadence.
 *
 * Env (ms, optional):
 *   HIBERNATION_CRON_CADENCE_MS  — trigger period (default 5m staging)
 *   HIBERNATION_WAKE_BUFFER_MS   — slack on top of cadence+avg (default 1m)
 *   HIBERNATION_WAKE_MIN_LEAD_MS — absolute floor (default 30m)
 */

/** Staging GH Actions hibernation cadence (every 5 minutes). Prod may set 60_000. */
export const DEFAULT_HIBERNATION_CRON_CADENCE_MS = 5 * 60 * 1000

/** Slack above cadence + avgWake. */
export const DEFAULT_WAKE_BUFFER_MS = 60 * 1000

/**
 * Absolute minimum lead — never thinner than this.
 * MUTATION: restore 8m → Aug-11 class (tick at T−11m ineligible, next tick
 * past-due after beat) fails the gap-floor tests.
 */
export const DEFAULT_WAKE_MIN_LEAD_MS = 30 * 60 * 1000

/** Fallback when ContainerState.avgWakeDurationMs is null. */
export const DEFAULT_AVG_WAKE_MS = 45 * 1000

function parseEnvMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

/**
 * Wake lead: max(minFloor, cadence + avgWake + buffer).
 * MUTATION: restoring `Math.max(120_000, avg*2)` 2m clamp → fail cadence-floor tests.
 */
export function computeWakeLeadMs(
  avgWakeDurationMs: number | null | undefined,
): number {
  const cadence = parseEnvMs(
    "HIBERNATION_CRON_CADENCE_MS",
    DEFAULT_HIBERNATION_CRON_CADENCE_MS,
  )
  const buffer = parseEnvMs(
    "HIBERNATION_WAKE_BUFFER_MS",
    DEFAULT_WAKE_BUFFER_MS,
  )
  const minLead = parseEnvMs(
    "HIBERNATION_WAKE_MIN_LEAD_MS",
    DEFAULT_WAKE_MIN_LEAD_MS,
  )
  const avg =
    typeof avgWakeDurationMs === "number" &&
    Number.isFinite(avgWakeDurationMs) &&
    avgWakeDurationMs > 0
      ? avgWakeDurationMs
      : DEFAULT_AVG_WAKE_MS

  return Math.max(minLead, cadence + avg + buffer)
}

/** True when now is at/after nextHeartbeatAt − lead (past-due included). */
export function isWakeEligible(args: {
  now: Date
  nextHeartbeatAt: Date
  avgWakeDurationMs: number | null | undefined
}): boolean {
  const lead = computeWakeLeadMs(args.avgWakeDurationMs)
  const wakeDeadline = args.nextHeartbeatAt.getTime() - lead
  return args.now.getTime() >= wakeDeadline
}

export function isPastDueHint(now: Date, nextHeartbeatAt: Date): boolean {
  return nextHeartbeatAt.getTime() < now.getTime()
}

export type WakeEligibilityLine = {
  workspaceId: string
  nextHeartbeatAt: string
  leadMs: number
  deadline: string
  eligible: boolean
  pastDue: boolean
}

/** One observability line per wake candidate (cron response + log). */
export function describeWakeEligibility(args: {
  workspaceId: string
  now: Date
  nextHeartbeatAt: Date
  avgWakeDurationMs: number | null | undefined
}): WakeEligibilityLine {
  const leadMs = computeWakeLeadMs(args.avgWakeDurationMs)
  const deadlineMs = args.nextHeartbeatAt.getTime() - leadMs
  const eligible = args.now.getTime() >= deadlineMs
  return {
    workspaceId: args.workspaceId,
    nextHeartbeatAt: args.nextHeartbeatAt.toISOString(),
    leadMs,
    deadline: new Date(deadlineMs).toISOString(),
    eligible,
    pastDue: isPastDueHint(args.now, args.nextHeartbeatAt),
  }
}

/**
 * UTC wall-clock literal for `timestamp without time zone` columns.
 * ContainerState.nextHeartbeatAt is NOT timestamptz — writers in a non-UTC
 * process TZ must not pass JS Date through node-pg (local wall skew).
 */
export function utcWallTimestamp(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ")
}
