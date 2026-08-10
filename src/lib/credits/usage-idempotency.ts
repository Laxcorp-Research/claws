import type { ProxyUsageRecord } from "@/lib/credits/proxy-metering-payload"

/**
 * Deterministic fingerprint for proxy usage rows (retry-safe).
 * Proxy may re-flush the same pending batch on 503; skip duplicates.
 */
export function usageRecordIdempotencyKey(r: ProxyUsageRecord): string {
  return [
    r.workspaceId,
    r.model,
    String(r.inputTokens),
    String(r.outputTokens),
    String(r.costCents),
    r.timestamp,
  ].join("|")
}
