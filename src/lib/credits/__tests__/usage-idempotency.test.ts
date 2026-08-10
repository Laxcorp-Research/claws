import { describe, expect, it } from "vitest"
import { buildProxyUsageRecord } from "@/lib/credits/proxy-metering-payload"
import { usageRecordIdempotencyKey } from "@/lib/credits/usage-idempotency"

describe("usageRecordIdempotencyKey", () => {
  it("stable fingerprint across identical proxy records", () => {
    const r = buildProxyUsageRecord({
      workspaceId: "ws-1",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 4,
      costCents: 2,
      timestamp: "2026-08-10T16:00:00.000Z",
    })
    expect(usageRecordIdempotencyKey(r)).toBe(usageRecordIdempotencyKey({ ...r }))
  })

  it("changes when cost or tokens change", () => {
    const base = buildProxyUsageRecord({
      workspaceId: "ws-1",
      model: "claude-haiku-4-5",
      inputTokens: 10,
      outputTokens: 4,
      costCents: 2,
      timestamp: "2026-08-10T16:00:00.000Z",
    })
    expect(usageRecordIdempotencyKey(base)).not.toBe(
      usageRecordIdempotencyKey({ ...base, costCents: 3 }),
    )
    expect(usageRecordIdempotencyKey(base)).not.toBe(
      usageRecordIdempotencyKey({ ...base, inputTokens: 11 }),
    )
  })
})
