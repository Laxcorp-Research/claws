/**
 * P2.3 wake geometry — lead floor + past-due eligibility.
 *
 * Staging hibernation cron is GH Actions every-5-minutes (gaps + jitter). A lead
 * narrower than that cadence (the old 2m clamp from avgWake*2) can make the
 * assist tick fire before the wake window opens, then skip forever once the
 * hint is past-due (gt-now upper cutoff). Lead must never be narrower than
 * the trigger's own gaps.
 *
 * Env (ms, optional):
 *   HIBERNATION_CRON_CADENCE_MS  — trigger period (default 5m staging)
 *   HIBERNATION_WAKE_BUFFER_MS   — slack on top of cadence+avg (default 1m)
 *   HIBERNATION_WAKE_MIN_LEAD_MS — absolute floor (default 8m)
 */

/** Staging GH Actions hibernation cadence (every 5 minutes). Prod may set 60_000. */
export const DEFAULT_HIBERNATION_CRON_CADENCE_MS = 5 * 60 * 1000

/** Slack above cadence + avgWake. */
export const DEFAULT_WAKE_BUFFER_MS = 60 * 1000

/** Absolute minimum lead — never thinner than this. */
export const DEFAULT_WAKE_MIN_LEAD_MS = 8 * 60 * 1000

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
