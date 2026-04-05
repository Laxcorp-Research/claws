import { describe, it, expect, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  createTestUser,
  createTestTemplate,
  cleanupTestData,
} from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Review submission rules", () => {
  const cleanup = {
    userIds: [] as string[],
    templateIds: [] as string[],
    skillIds: [] as string[],
  }

  afterAll(async () => {
    if (cleanup.skillIds.length > 0) {
      await prisma.skillReview.deleteMany({ where: { skillId: { in: cleanup.skillIds } } })
    }
    await cleanupTestData(cleanup)
  })

  it("only allows one review per user per template", async () => {
    const user = await createTestUser()
    const template = await createTestTemplate()
    cleanup.userIds.push(user.id)
    cleanup.templateIds.push(template.id)

    await prisma.templateReview.create({
      data: {
        clawTemplateId: template.id,
        userId: user.id,
        rating: 5,
        title: "Great template",
        body: "Really helpful.",
        verifiedInstall: false,
      },
    })

    await expect(
      prisma.templateReview.create({
        data: {
          clawTemplateId: template.id,
          userId: user.id,
          rating: 3,
          title: "Changed my mind",
        },
      }),
    ).rejects.toThrow()
  })

  it("marks review as verified when user has TemplateInstall record", async () => {
    const user = await createTestUser()
    const template = await createTestTemplate()
    cleanup.userIds.push(user.id)
    cleanup.templateIds.push(template.id)

    await prisma.templateInstall.create({
      data: {
        templateId: template.id,
        userId: user.id,
      },
    })

    const install = await prisma.templateInstall.findUnique({
      where: {
        templateId_userId: {
          templateId: template.id,
          userId: user.id,
        },
      },
    })

    expect(install).not.toBeNull()

    const review = await prisma.templateReview.create({
      data: {
        clawTemplateId: template.id,
        userId: user.id,
        rating: 5,
        title: "Great template",
        verifiedInstall: install !== null,
      },
    })

    expect(review.verifiedInstall).toBe(true)
  })

  it("only allows one review per user per skill", async () => {
    const user = await createTestUser()
    const skill = await prisma.marketplaceSkill.create({
      data: {
        slug: `test-skill-review-${Date.now()}`,
        name: "Review Test Skill",
        description: "For testing reviews",
        category: "Productivity",
        tags: [],
        skillMd: "# Test",
        requiredBins: [],
        requiredEnvVars: [],
        isPublished: true,
        trustTier: "UNREVIEWED",
      },
    })
    cleanup.userIds.push(user.id)
    cleanup.skillIds.push(skill.id)

    await prisma.skillReview.create({
      data: {
        skillId: skill.id,
        userId: user.id,
        rating: 4,
      },
    })

    await expect(
      prisma.skillReview.create({
        data: {
          skillId: skill.id,
          userId: user.id,
          rating: 2,
        },
      }),
    ).rejects.toThrow()
  })
})
