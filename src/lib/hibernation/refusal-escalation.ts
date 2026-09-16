/**
 * OWNER-PLANE NOISE FIX: hibernation-refused escalation.
 *
 * Before this module, EVERY refused auto-hibernate tick (the cron runs per
 * minute) ledgered an ERROR row AND paged the founder via sendOwnerAlert
 * (which has no dedup). The prod canary's first post-9.4-migration sync
 * (~29MB bundle vs the stale 10s budget) produced 4 ERROR rows + 4 pages
 * in 4 minutes (2026-09-16 08:45-08:48Z) for a condition that self-healed
 * on the fifth tick.
 *
 * Policy now:
 *   - attempts 1..N-1 (N = REFUSAL_SILENT_RETRIES): silent retry - SYSTEM
 *     ledger row, no page. Retries are additionally spaced by
 *     refusalBackoffMs (2m, 4m, 8m cap) instead of hammering every tick.
 *   - attempt N (exhaust): ONE owner page + ERROR row, deduped 12h per
 *     workspace+class (the ledgered alert row is the dedup source).
 *   - next successful hibernate after a page: resolve-message, once.
 *
 * MUTATION: restoring the per-tick alert (dropping decideRefusalEscalation
 * from the manager, or alerting when sendAlert=false) fails the manager
 * escalation tests.
 */

export const REFUSAL_SILENT_RETRIES = 3
export const REFUSAL_ALERT_DEDUP_MS = 12 * 60 * 60 * 1000
/** Episode boundary: refusals older than this never count toward escalation. */
export const REFUSAL_LOOKBACK_MS = 6 * 60 * 60 * 1000
/** Backoff cap between refused attempts. */
export const REFUSAL_BACKOFF_CAP_MS = 8 * 60 * 1000

export const HIBERNATION_REFUSED_EVENT_KIND = "hibernation_refused"
export const REFUSAL_ALERT_PUSHED_EVENT_KIND = "hibernation_refusal_alert_pushed"
export const REFUSAL_ALERT_RESOLVED_EVENT_KIND = "hibernation_refusal_resolved"

export type RefusalEscalation = {
  /** 1-based attempt number including the current refusal. */
  attempt: number
  /** SYSTEM while silently retrying; ERROR exactly when the owner is paged. */
  ledgerActionType: "SYSTEM" | "ERROR"
  sendAlert: boolean
}

export function decideRefusalEscalation(args: {
  /** hibernation_refused rows already ledgered this episode (since last success, bounded by lookback). */
  priorRefusalsThisEpisode: number
  /** Last delivered hibernation-refusal page for this workspace, or null. */
  lastAlertAtMs: number | null
  nowMs: number
}): RefusalEscalation {
  const attempt = args.priorRefusalsThisEpisode + 1
  const exhausted = attempt >= REFUSAL_SILENT_RETRIES
  const dedupOpen =
    args.lastAlertAtMs == null || args.nowMs - args.lastAlertAtMs >= REFUSAL_ALERT_DEDUP_MS
  const sendAlert = exhausted && dedupOpen
  return {
    attempt,
    sendAlert,
    ledgerActionType: sendAlert ? "ERROR" : "SYSTEM",
  }
}

/**
 * Backoff between refused attempts: 0 before the first attempt, then
 * 2m, 4m, 8m (cap). The hibernation cron ticks per minute; the manager
 * skips the sync attempt entirely (silent, no ledger) while inside the
 * backoff window so a struggling container is not hammered.
 */
export function refusalBackoffMs(priorRefusalsThisEpisode: number): number {
  if (priorRefusalsThisEpisode <= 0) return 0
  const ms = 2 ** priorRefusalsThisEpisode * 60 * 1000
  return Math.min(ms, REFUSAL_BACKOFF_CAP_MS)
}
