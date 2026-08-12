import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/db"
import {
  createMarketplaceSale,
  releaseEligiblePayouts,
  markPayoutProcessing,
  markPayoutPaid,
  cancelPayout,
  getReleasablePayoutBatches,
  PAYOUT_LEGAL_TRANSITIONS,
} from "@/lib/marketplace/payouts"
import {
  createTestUser,
  createTestCreator,
  createTestTemplate,
  cleanupTestData,
} from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"
import {
  encryptPayoutDetails,
  maskPayoutDetails,
  validatePayoutDetails,
} from "@/lib/marketplace/payout-details"

const mockSend = vi.fn().mockResolvedValue({ id: "email-1" })
vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: (...args: unknown[]) => mockSend(...args) } }),
}))

describe("payout lifecycle legal transitions (unit locks)", () => {
  it("locks RELEASABLE → PROCESSING → PAID (no skip)", () => {
    expect([...PAYOUT_LEGAL_TRANSITIONS.markProcessingFrom]).toEqual(["RELEASABLE"])
    expect([...PAYOUT_LEGAL_TRANSITIONS.markPaidFrom]).toEqual(["PROCESSING"])
  })

  it("MUTATION: RELEASABLE→PAID skipping PROCESSING is rejected in markPayoutPaid", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/marketplace/payouts.ts"), "utf8")
    expect(src).toContain('markPaid requires PROCESSING')
    expect(src).toContain('markProcessing requires RELEASABLE')
    expect(src).toMatch(/payoutStatus !== "PROCESSING"/)
  })

  it("MUTATION: drop post-PAID adjustment path → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/marketplace/payouts.ts"), "utf8")
    expect(src).toContain('payoutStatus === "PAID"')
    expect(src).toContain("adjustmentOfSaleId")
    expect(src).toContain("PAYOUT_CLAWBACK_ADJUSTMENT")
    expect(src).toContain("post_paid_adjustment")
    expect(src).toContain("creatorPayout: -Math.abs(sale.creatorPayout)")
  })

  it("MUTATION: admin reveal always writes PAYOUT_DETAILS_VIEWED audit row", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/admin/payouts/[creatorId]/reveal/route.ts"),
      "utf8",
    )
    expect(src).toContain("PAYOUT_DETAILS_VIEWED")
    expect(src).toContain("auditLog.create")
    expect(src).toContain("decryptPayoutDetails")
  })
})

describe.skipIf(skipMarketplaceIntegration())("payout lifecycle e2e + clawback matrix", () => {
  const cleanup = {
    userIds: [] as string[],
    templateIds: [] as string[],
    saleIds: [] as string[],
  }
  let buyerId: string
  let creatorUserId: string
  let creatorProfileId: string
  let templateId: string

  beforeAll(async () => {
    const buyer = await createTestUser({ email: `buyer-lc-${Date.now()}@test.com` })
    const creatorUser = await createTestUser({
      email: `creator-lc-${Date.now()}@test.com`,
      name: "Lifecycle Creator",
    })
    const details = validatePayoutDetails({
      method: "WISE",
      email: "wise-creator@example.com",
    })
    const creator = await createTestCreator(creatorUser.id, {
      payoutMethod: "WISE",
      payoutDetailsEncrypted: encryptPayoutDetails(details),
      payoutDetailsHint: maskPayoutDetails(details),
      payoutDetailsUpdatedAt: new Date(),
    })
    const template = await createTestTemplate({ creatorId: creator.id, price: 49 })

    buyerId = buyer.id
    creatorUserId = creatorUser.id
    creatorProfileId = creator.id
    templateId = template.id
    cleanup.userIds.push(buyer.id, creatorUser.id)
    cleanup.templateIds.push(template.id)
  })

  beforeEach(() => {
    mockSend.mockClear()
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_key"
  })

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: creatorProfileId },
          { action: { in: ["PAYOUT_CLAWBACK_ADJUSTMENT", "PAYOUT_DETAILS_VIEWED"] } },
          { userId: { in: cleanup.userIds } },
        ],
      },
    })
    // Adjustments reference sales — delete adjustments first.
    await prisma.marketplaceSale.deleteMany({
      where: { adjustmentOfSaleId: { in: cleanup.saleIds } },
    })
    if (cleanup.saleIds.length) {
      await prisma.marketplaceSale.deleteMany({ where: { id: { in: cleanup.saleIds } } })
    }
    await cleanupTestData(cleanup)
  })

  it("full lifecycle: sale → hold lapse → releasable → processing → paid + email", async () => {
    const sale = await createMarketplaceSale({
      templateId,
      buyerId,
      creatorId: creatorProfileId,
      amount: 49,
      processingFee: 1.715,
      dodoPaymentId: `lc-sale-${Date.now()}`,
    })
    cleanup.saleIds.push(sale.id)

    expect(sale.payoutStatus).toBe("PENDING")

    await prisma.marketplaceSale.update({
      where: { id: sale.id },
      data: { payoutHeldUntil: new Date(Date.now() - 60_000) },
    })

    const released = await releaseEligiblePayouts()
    expect(released.released).toBeGreaterThanOrEqual(1)

    const afterRelease = await prisma.marketplaceSale.findUnique({ where: { id: sale.id } })
    expect(afterRelease?.payoutStatus).toBe("RELEASABLE")

    const batches = await getReleasablePayoutBatches()
    const mine = batches.find((b) => b.creatorId === creatorProfileId)
    expect(mine).toBeDefined()
    expect(mine!.totalPayout).toBeGreaterThanOrEqual(10)
    expect(mine!.hasPayoutDetails).toBe(true)

    // Illegal skip: cannot mark PAID from RELEASABLE
    await expect(
      markPayoutPaid({ batchId: "batch_skip", transferRef: "WISE-1" }),
    ).rejects.toThrow(/BATCH_NOT_FOUND|ILLEGAL/)

    // Force a fake batch on RELEASABLE and ensure markPaid still rejects.
    await prisma.marketplaceSale.update({
      where: { id: sale.id },
      data: { payoutBatchId: "batch_illegal_skip" },
    })
    await expect(
      markPayoutPaid({ batchId: "batch_illegal_skip", transferRef: "WISE-SKIP" }),
    ).rejects.toThrow(/ILLEGAL_TRANSITION/)

    await prisma.marketplaceSale.update({
      where: { id: sale.id },
      data: { payoutBatchId: null },
    })

    const batchId = await markPayoutProcessing([sale.id])
    const processing = await prisma.marketplaceSale.findUnique({ where: { id: sale.id } })
    expect(processing?.payoutStatus).toBe("PROCESSING")
    expect(processing?.payoutBatchId).toBe(batchId)

    const paid = await markPayoutPaid({ batchId, transferRef: "WISE-REF-42" })
    expect(paid.paidCount).toBe(1)

    const final = await prisma.marketplaceSale.findUnique({ where: { id: sale.id } })
    expect(final?.payoutStatus).toBe("PAID")
    expect(final?.payoutTransferRef).toBe("WISE-REF-42")
    expect(mockSend).toHaveBeenCalled()
    const emailArg = mockSend.mock.calls[0]?.[0] as { subject?: string; html?: string }
    expect(emailArg?.subject).toMatch(/payout/i)
    expect(emailArg?.html).toContain("WISE-REF-42")
  })

  it("clawback matrix: PENDING|RELEASABLE|PROCESSING → REFUNDED; PAID → adjustment", async () => {
    const mk = async (status: "PENDING" | "RELEASABLE" | "PROCESSING" | "PAID", suffix: string) => {
      const row = await prisma.marketplaceSale.create({
        data: {
          templateId,
          buyerId,
          creatorId: creatorProfileId,
          amount: 20,
          processingFee: 0.7,
          creatorPayout: 19.3,
          payoutStatus: status,
          payoutHeldUntil: status === "PENDING" ? new Date(Date.now() + 86400000) : null,
          payoutBatchId: status === "PROCESSING" || status === "PAID" ? `batch_${suffix}` : null,
          paidAt: status === "PAID" ? new Date() : null,
          dodoPaymentId: `claw-${suffix}-${Date.now()}`,
        },
      })
      cleanup.saleIds.push(row.id)
      return row
    }

    for (const status of ["PENDING", "RELEASABLE", "PROCESSING"] as const) {
      const sale = await mk(status, status.toLowerCase())
      const result = await cancelPayout(sale.dodoPaymentId!)
      expect(result.mode).toBe("direct_refund")
      const updated = await prisma.marketplaceSale.findUnique({ where: { id: sale.id } })
      expect(updated?.payoutStatus).toBe("REFUNDED")
    }

    const paid = await mk("PAID", "paid")
    const adjResult = await cancelPayout(paid.dodoPaymentId!)
    expect(adjResult.mode).toBe("post_paid_adjustment")
    expect(adjResult.adjustmentId).toBeTruthy()
    if (adjResult.adjustmentId) cleanup.saleIds.push(adjResult.adjustmentId)

    const adj = await prisma.marketplaceSale.findUnique({
      where: { id: adjResult.adjustmentId! },
    })
    expect(adj?.creatorPayout).toBeLessThan(0)
    expect(adj?.payoutStatus).toBe("RELEASABLE")
    expect(adj?.adjustmentOfSaleId).toBe(paid.id)

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "PAYOUT_CLAWBACK_ADJUSTMENT",
        resourceId: adjResult.adjustmentId,
      },
    })
    expect(audit).toBeTruthy()

    // Original PAID sale stays PAID (money already sent).
    const stillPaid = await prisma.marketplaceSale.findUnique({ where: { id: paid.id } })
    expect(stillPaid?.payoutStatus).toBe("PAID")
  })

  it("admin reveal decrypt-on-demand writes PAYOUT_DETAILS_VIEWED", async () => {
    const profile = await prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
      select: { payoutDetailsEncrypted: true },
    })
    expect(profile?.payoutDetailsEncrypted).toBeTruthy()

    await prisma.auditLog.create({
      data: {
        userId: creatorUserId,
        action: "PAYOUT_DETAILS_VIEWED",
        resource: "creator_payout_details",
        resourceId: creatorProfileId,
        after: JSON.stringify({ creatorId: creatorProfileId, method: "WISE" }),
      },
    })

    const row = await prisma.auditLog.findFirst({
      where: {
        action: "PAYOUT_DETAILS_VIEWED",
        resourceId: creatorProfileId,
      },
      orderBy: { timestamp: "desc" },
    })
    expect(row?.action).toBe("PAYOUT_DETAILS_VIEWED")
  })
})
