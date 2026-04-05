import { describe, it, expect, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  createTestTemplate,
  cleanupTestData,
} from "@/__tests__/helpers/marketplace"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Template publish validation", () => {
  const cleanup = { templateIds: [] as string[] }

  afterAll(async () => {
    await cleanupTestData(cleanup)
  })

  describe("Name conflict validation", () => {
    it("rejects template name that conflicts with official template (case-insensitive)", async () => {
      const official = await createTestTemplate({
        name: "Quant Trader",
        trustTier: "OFFICIAL",
      })
      cleanup.templateIds.push(official.id)

      const conflict = await prisma.clawTemplate.findFirst({
        where: {
          name: { equals: "quant trader", mode: "insensitive" },
          trustTier: "OFFICIAL",
        },
      })

      expect(conflict).not.toBeNull()
      expect(conflict?.id).toBe(official.id)
    })

    it("allows template name that does NOT conflict with official templates", async () => {
      const conflict = await prisma.clawTemplate.findFirst({
        where: {
          name: { equals: "my unique custom template name xyz", mode: "insensitive" },
          trustTier: "OFFICIAL",
        },
      })

      expect(conflict).toBeNull()
    })

    it("allows same name as non-official template", async () => {
      const community = await createTestTemplate({
        name: "Community Template Alpha",
        trustTier: "UNREVIEWED",
      })
      cleanup.templateIds.push(community.id)

      const conflict = await prisma.clawTemplate.findFirst({
        where: {
          name: { equals: "Community Template Alpha", mode: "insensitive" },
          trustTier: "OFFICIAL",
        },
      })

      expect(conflict).toBeNull()
    })
  })
})
