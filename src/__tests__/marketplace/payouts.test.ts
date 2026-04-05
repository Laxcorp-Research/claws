import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  createMarketplaceSale,
  releaseEligiblePayouts,
  getCreatorEarnings,
  cancelPayout,
} from "@/lib/marketplace/payouts"
import {
  createTestUser,
  createTestCreator,
  createTestTemplate,
  cleanupTestData,
} from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Marketplace payout logic", () => {
  const cleanup = {
    userIds: [] as string[],
    templateIds: [] as string[],
    saleIds: [] as string[],
  }
  let buyerId: string
  let creatorProfileId: string
  let templateId: string

  beforeAll(async () => {
    const buyer = await createTestUser({ email: `buyer-${Date.now()}@test.com` })
    const creatorUser = await createTestUser({ email: `creator-${Date.now()}@test.com` })
    const creator = await createTestCreator(creatorUser.id)
    const template = await createTestTemplate({ creatorId: creator.id })

    buyerId = buyer.id
    creatorProfileId = creator.id
    templateId = template.id

    cleanup.userIds.push(buyer.id, creatorUser.id)
    cleanup.templateIds.push(template.id)
  })

  afterAll(async () => {
    if (cleanup.saleIds.length) {
      await prisma.marketplaceSale.deleteMany({ where: { id: { in: cleanup.saleIds } } })
    }
    await cleanupTestData(cleanup)
  })

  it("creates a sale with PENDING status and 7-day hold", async () => {
    const sale = await createMarketplaceSale({
      templateId,
      buyerId,
      creatorId: creatorProfileId,
      amount: 49,
      processingFee: 1.96,
      dodoPaymentId: `test-payment-${Date.now()}`,
    })
    cleanup.saleIds.push(sale.id)

    expect(sale.payoutStatus).toBe("PENDING")
    expect(sale.creatorPayout).toBeCloseTo(47.04, 2)
    expect(sale.payoutHeldUntil).toBeDefined()

    const holdMs = sale.payoutHeldUntil!.getTime() - Date.now()
    const holdDays = holdMs / (1000 * 60 * 60 * 24)
    expect(holdDays).toBeGreaterThan(6.9)
    expect(holdDays).toBeLessThan(7.1)
  })

  it("does NOT release payouts still in hold period", async () => {
    await releaseEligiblePayouts()

    const sale = await prisma.marketplaceSale.findFirst({
      where: { id: { in: cleanup.saleIds } },
    })

    expect(sale?.payoutStatus).toBe("PENDING")
  })

  it("releases payouts when hold period expires", async () => {
    const expiredSale = await prisma.marketplaceSale.create({
      data: {
        templateId,
        buyerId,
        creatorId: creatorProfileId,
        amount: 29,
        processingFee: 1.16,
        creatorPayout: 27.84,
        payoutStatus: "PENDING",
        payoutHeldUntil: new Date(Date.now() - 1000 * 60 * 60),
        dodoPaymentId: `test-expired-${Date.now()}`,
      },
    })
    cleanup.saleIds.push(expiredSale.id)

    const result = await releaseEligiblePayouts()
    expect(result.released).toBeGreaterThanOrEqual(1)

    const updated = await prisma.marketplaceSale.findUnique({
      where: { id: expiredSale.id },
    })

    expect(updated?.payoutStatus).toBe("RELEASABLE")
  })

  it("cancels payout on refund", async () => {
    const refundSale = await prisma.marketplaceSale.create({
      data: {
        templateId,
        buyerId,
        creatorId: creatorProfileId,
        amount: 19,
        processingFee: 0.76,
        creatorPayout: 18.24,
        payoutStatus: "PENDING",
        payoutHeldUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
        dodoPaymentId: `test-refund-${Date.now()}`,
      },
    })
    cleanup.saleIds.push(refundSale.id)

    await cancelPayout(refundSale.dodoPaymentId!)

    const updated = await prisma.marketplaceSale.findUnique({
      where: { id: refundSale.id },
    })

    expect(updated?.payoutStatus).toBe("REFUNDED")
  })

  it("computes creator earnings correctly", async () => {
    const paidSale = await prisma.marketplaceSale.create({
      data: {
        templateId,
        buyerId,
        creatorId: creatorProfileId,
        amount: 99,
        processingFee: 3.96,
        creatorPayout: 95.04,
        payoutStatus: "PAID",
        paidAt: new Date(),
        dodoPaymentId: `test-paid-${Date.now()}`,
      },
    })
    cleanup.saleIds.push(paidSale.id)

    const earnings = await getCreatorEarnings(creatorProfileId)

    expect(earnings.totalEarned).toBeGreaterThanOrEqual(95.04)
    expect(earnings.pendingPayout).toBeGreaterThanOrEqual(0)
    expect(earnings.recentSales.length).toBeGreaterThan(0)
  })
})
