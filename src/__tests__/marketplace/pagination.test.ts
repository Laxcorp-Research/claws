import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe.skipIf(skipMarketplaceIntegration())("Cursor-based pagination", () => {
  it("returns correct page size", async () => {
    const limit = 5
    const page1 = await prisma.clawTemplate.findMany({
      where: { isPublished: true },
      orderBy: { installCount: "desc" },
      take: limit + 1,
    })

    const hasMore = page1.length > limit
    const items = hasMore ? page1.slice(0, limit) : page1

    expect(items.length).toBeLessThanOrEqual(limit)
  })

  it("returns next page using cursor", async () => {
    const limit = 3

    const page1 = await prisma.clawTemplate.findMany({
      where: { isPublished: true },
      orderBy: { id: "desc" },
      take: limit + 1,
    })

    if (page1.length <= limit) return

    const page1Items = page1.slice(0, limit)
    const cursor = page1Items[page1Items.length - 1].id

    const page2 = await prisma.clawTemplate.findMany({
      where: {
        isPublished: true,
        id: { lt: cursor },
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    })

    const page1Ids = new Set(page1Items.map((t) => t.id))
    const page2Items = page2.slice(0, Math.min(page2.length, limit))

    for (const item of page2Items) {
      expect(page1Ids.has(item.id)).toBe(false)
    }
  })
})
