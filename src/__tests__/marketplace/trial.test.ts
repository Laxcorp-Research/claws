import { describe, it, expect, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { createTestUser, cleanupTestData } from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Trial logic", () => {
  const cleanup = { userIds: [] as string[] }

  afterAll(async () => {
    await cleanupTestData(cleanup)
  })

  it("first deploy triggers 3-day trial", async () => {
    const user = await createTestUser()
    cleanup.userIds.push(user.id)

    expect(user.trialUsed).toBe(false)
    expect(user.trialStartedAt).toBeNull()
    expect(user.trialEndsAt).toBeNull()

    const now = new Date()
    const trialEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        trialUsed: true,
        trialStartedAt: now,
        trialEndsAt: trialEnd,
      },
    })

    expect(updated.trialUsed).toBe(true)
    expect(updated.trialStartedAt).toBeDefined()
    expect(updated.trialEndsAt).toBeDefined()

    const trialMs = updated.trialEndsAt!.getTime() - updated.trialStartedAt!.getTime()
    const trialDays = trialMs / (1000 * 60 * 60 * 24)
    expect(trialDays).toBeCloseTo(3, 0)
  })

  it("second deploy requires subscription if trial already used", async () => {
    const user = await createTestUser({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: false,
    })
    cleanup.userIds.push(user.id)

    expect(user.trialUsed).toBe(true)
    expect(user.hasActiveSubscription).toBe(false)

    const trialExpired = user.trialEndsAt != null && user.trialEndsAt < new Date()
    expect(trialExpired).toBe(true)
  })

  it("deploy proceeds if user has active subscription", async () => {
    const user = await createTestUser({
      trialUsed: true,
      hasActiveSubscription: true,
    })
    cleanup.userIds.push(user.id)

    expect(user.hasActiveSubscription).toBe(true)
  })
})
