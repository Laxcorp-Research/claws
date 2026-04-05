import { describe, it, expect, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { createTestUser, cleanupTestData } from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Creator enrollment", () => {
  const cleanup = { userIds: [] as string[] }

  afterAll(async () => {
    await cleanupTestData(cleanup)
  })

  it("creates a CreatorProfile immediately on enrollment", async () => {
    const user = await createTestUser()
    cleanup.userIds.push(user.id)

    const creator = await prisma.creatorProfile.create({
      data: {
        userId: user.id,
        displayName: "Test Creator",
        agreedToTermsAt: new Date(),
      },
    })

    expect(creator.id).toBeDefined()
    expect(creator.displayName).toBe("Test Creator")
    expect(creator.totalInstalls).toBe(0)
    expect(creator.totalTemplates).toBe(0)
    expect(creator.isActive).toBe(true)
  })

  it("enforces one creator profile per user", async () => {
    const user = await createTestUser()
    cleanup.userIds.push(user.id)

    await prisma.creatorProfile.create({
      data: {
        userId: user.id,
        displayName: "Creator 1",
        agreedToTermsAt: new Date(),
      },
    })

    await expect(
      prisma.creatorProfile.create({
        data: {
          userId: user.id,
          displayName: "Creator 2",
          agreedToTermsAt: new Date(),
        },
      }),
    ).rejects.toThrow()
  })
})
