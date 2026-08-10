/**
 * Raw CreditUsageRecord retention after daily rollup.
 * Billing needs multi-week row visibility; 7d purge caused prod
 * totalConsumedCents with ZERO live rows (daily rollup remained).
 *
 * MUTATION: restoring 7 * 86400000 → billing gap regression tests fail.
 */
export const CREDIT_USAGE_RETENTION_MS = 90 * 86400000

export const PRE_INSTRUMENTATION_NOTE_EVENT_KIND = "credit_usage_pre_instrumentation_note"

export function creditUsageRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - CREDIT_USAGE_RETENTION_MS)
}
