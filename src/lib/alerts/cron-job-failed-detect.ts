/**
 * PR-B: cron-job-failed detection for the critical-alerts push.
 *
 * The container reports a failed scheduled job as a MESSAGE_SENT activity
 * event, e.g.:
 *   'Sent to telegram: Cron job "orchestrator-heartbeat-md-0-12-16-20"
 *    failed: LLM request rejected: ...'
 * (this is the SAME text shape thinking-signature poison detects - poison
 * is one specific cause of a cron job failing; this module fires on the
 * broader "same job failed repeatedly" signal regardless of cause.)
 *
 * DETECT (pure, per-event) → caller counts repeats for the same job name
 * within CRON_JOB_FAILED_WINDOW_MS → decideCronJobFailedAlert (pure) decides
 * whether the repeat count crosses the alert threshold.
 */

export const CRON_JOB_FAILED_RE = /Cron job "([^"]+)" failed/i

/** Repeat-failure lookback window for the same job name. */
export const CRON_JOB_FAILED_WINDOW_MS = 6 * 60 * 60 * 1000

/** "Same job 2+ consecutive" - the second failure in-window triggers the push. */
export const CRON_JOB_FAILED_MIN_COUNT = 2

export type CronJobFailedDetectInput = {
  type: string
  action?: string | null
  detail?: string | null
}

/**
 * True when activity text matches the "Cron job "<name>" failed" shape.
 * MUTATION: emptying CRON_JOB_FAILED_RE or hardcoding false breaks this.
 */
export function isCronJobFailedEvent(input: CronJobFailedDetectInput): boolean {
  if (input.type !== "MESSAGE_SENT") return false
  const haystack = [input.action, input.detail]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n")
  return CRON_JOB_FAILED_RE.test(haystack)
}

/** Extract the job name from `Cron job "<name>" failed` text. Null if absent. */
export function extractCronJobName(
  ...texts: Array<string | null | undefined>
): string | null {
  for (const text of texts) {
    if (!text) continue
    const match = CRON_JOB_FAILED_RE.exec(text)
    if (match?.[1]) return match[1]
  }
  return null
}

/**
 * Pure planner: given how many matching cron-fail MESSAGE_SENT rows exist
 * for this job in the lookback window (including the one just written),
 * decide whether the repeat count crosses the alert threshold.
 * MUTATION: dropping the >= CRON_JOB_FAILED_MIN_COUNT comparison (e.g.
 * always-true) breaks the "single failure does not alert" case.
 */
export function decideCronJobFailedAlert(args: { recentFailureCount: number }): boolean {
  return args.recentFailureCount >= CRON_JOB_FAILED_MIN_COUNT
}
