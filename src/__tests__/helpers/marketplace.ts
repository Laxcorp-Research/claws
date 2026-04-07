import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"

export async function createTestUser(overrides?: Partial<Prisma.UserCreateInput>) {
  return prisma.user.create({
    data: {
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      name: "Test User",
      ...overrides,
    },
  })
}

export async function createTestCreator(
  userId: string,
  overrides?: Partial<Omit<Prisma.CreatorProfileUncheckedCreateInput, "userId">>,
) {
  return prisma.creatorProfile.create({
    data: {
      userId,
      displayName: "Test Creator",
      agreedToTermsAt: new Date(),
      ...overrides,
    },
  })
}

export async function createTestTemplate(overrides?: Partial<Prisma.ClawTemplateUncheckedCreateInput>) {
  return prisma.clawTemplate.create({
    data: {
      slug: `test-template-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `Test Template ${Date.now()}`,
      tagline: "A test template",
      description: "Test template description for testing purposes",
      category: "LIFESTYLE",
      tags: ["test"],
      agentCount: 3,
      price: 49,
      isFree: false,
      trustTier: "OFFICIAL",
      isPublished: true,
      estimatedMonthlyCost: "5",
      workspaceSnapshot: JSON.stringify({ agents: [], connections: [] }),
      ...overrides,
    },
  })
}

export async function createTestSkill(overrides?: Partial<Prisma.MarketplaceSkillUncheckedCreateInput>) {
  return prisma.marketplaceSkill.create({
    data: {
      slug: `test-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `Test Skill ${Date.now()}`,
      description: "A test skill for unit testing",
      category: "Productivity",
      tags: ["test"],
      skillMd: "# Test Skill\n\nA test skill.",
      requiredBins: [],
      requiredEnvVars: [],
      isFree: true,
      isPublished: true,
      publishedAt: new Date(),
      trustTier: "UNREVIEWED",
      ...overrides,
    },
  })
}

export async function cleanupTestData(ids: {
  userIds?: string[]
  templateIds?: string[]
  skillIds?: string[]
  saleIds?: string[]
}) {
  if (ids.saleIds?.length) {
    await prisma.marketplaceSale.deleteMany({ where: { id: { in: ids.saleIds } } })
  }
  if (ids.templateIds?.length) {
    await prisma.clawTemplate.deleteMany({ where: { id: { in: ids.templateIds } } })
  }
  if (ids.skillIds?.length) {
    await prisma.marketplaceSkill.deleteMany({ where: { id: { in: ids.skillIds } } })
  }
  if (ids.userIds?.length) {
    await prisma.creatorProfile.deleteMany({ where: { userId: { in: ids.userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } })
  }
}
