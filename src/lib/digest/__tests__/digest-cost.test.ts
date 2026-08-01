import { describe, expect, it } from "vitest"
import { resolveDigestCostCents } from "@/lib/digest/digest-cost"

describe("resolveDigestCostCents", () => {
  it("PLATFORM_CREDIT uses credit ledger cents unchanged (even when activity nonzero)", () => {
    const r = resolveDigestCostCents({
      apiKeySource: "PLATFORM_CREDIT",
      creditCents: 250,
      activityDollars: 9.99,
      activityIsEstimate: true,
    })
    expect(r).toEqual({
      costCents24h: 250,
      costIsEstimate: false,
      source: "credit_usage",
    })
  })

  it("BYOK-shaped case: nonzero cents when activity window has cost", () => {
    const r = resolveDigestCostCents({
      apiKeySource: "USER_OWN_KEY",
      creditCents: 0,
      activityDollars: 1.23,
      activityIsEstimate: false,
    })
    expect(r.costCents24h).toBe(123)
    expect(r.costIsEstimate).toBe(false)
    expect(r.source).toBe("activity_window")
  })

  it("BYOK with estimate flag labels est.", () => {
    const r = resolveDigestCostCents({
      apiKeySource: "USER_OWN_KEY",
      creditCents: 0,
      activityDollars: 0.4,
      activityIsEstimate: true,
    })
    expect(r.costCents24h).toBe(40)
    expect(r.costIsEstimate).toBe(true)
  })

  it("MUTATION: routing BYOK through credit_usage leaves $0 when credit empty", () => {
    const creditBlind = resolveDigestCostCents({
      apiKeySource: "PLATFORM_CREDIT",
      creditCents: 0,
      activityDollars: 5,
      activityIsEstimate: false,
    })
    expect(creditBlind.costCents24h).toBe(0)
    expect(creditBlind.source).toBe("credit_usage")

    const byok = resolveDigestCostCents({
      apiKeySource: "USER_OWN_KEY",
      creditCents: 0,
      activityDollars: 5,
      activityIsEstimate: false,
    })
    expect(byok.costCents24h).toBe(500)
    expect(byok.source).toBe("activity_window")
  })
})
