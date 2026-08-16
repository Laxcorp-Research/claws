import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { marketplaceFeeFromPaid, paidDollarsFromWebhook } from "@/lib/marketplace/paid-amount"

describe("paidDollarsFromWebhook", () => {
  it("reads data.total_amount cents → dollars (post-discount)", () => {
    expect(paidDollarsFromWebhook({ total_amount: 2000 })).toBe(20)
    expect(paidDollarsFromWebhook({ total_amount: 0 })).toBe(0)
    expect(paidDollarsFromWebhook({ total_amount: 4900 })).toBe(49)
  })

  it("rejects missing / non-numeric total_amount (never invent list price)", () => {
    expect(paidDollarsFromWebhook(undefined)).toBeNull()
    expect(paidDollarsFromWebhook({})).toBeNull()
    expect(paidDollarsFromWebhook({ total_amount: "4900" })).toBeNull()
  })
})

describe("marketplaceFeeFromPaid", () => {
  it("3.5% fee + payout from paid amount, not list", () => {
    const { amount, processingFee } = marketplaceFeeFromPaid(20)
    expect(amount).toBe(20)
    expect(processingFee).toBeCloseTo(0.7, 2)
    expect(amount - processingFee).toBeCloseTo(19.3, 2)
  })
})

describe("MUTATION: list-price sale mint restored → fail", () => {
  it("webhook sale amount comes from paidDollarsFromWebhook, not listing price", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/dodo-payments/webhook/route.ts"),
      "utf8",
    )
    expect(src).toContain("paidDollarsFromWebhook")
    expect(src).toContain("marketplaceFeeFromPaid")
    expect(src).toContain("total_amount")
    expect(src).not.toMatch(/amount:\s*template\.price/)
    expect(src).not.toMatch(/amount:\s*skill\.price/)
    expect(src).not.toMatch(/skill\.price\s*\*\s*0\.035/)
    expect(src).not.toMatch(/template\.price\s*\*\s*0\.035/)
  })
})
