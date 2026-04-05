import { describe, it, expect, beforeAll } from "vitest"
import { buildTsQuery } from "@/lib/marketplace/search"
import { prisma } from "@/lib/db"
import { skipMarketplaceIntegration } from "@/test/marketplace-integration"

describe("Full-text search", () => {
  describe("buildTsQuery", () => {
    it("builds AND query from multiple words", () => {
      expect(buildTsQuery("trading crypto")).toBe("trading:* & crypto:*")
    })

    it("handles single word", () => {
      expect(buildTsQuery("sales")).toBe("sales:*")
    })

    it("strips special characters", () => {
      expect(buildTsQuery("hello; DROP TABLE--")).toBe("hello:* & DROP:* & TABLE:*")
    })

    it("returns empty for empty input", () => {
      expect(buildTsQuery("")).toBe("")
      expect(buildTsQuery("   ")).toBe("")
    })

    it("handles single character words", () => {
      expect(buildTsQuery("a b c")).toBe("a:* & b:* & c:*")
    })

    it("strips SQL injection attempts", () => {
      const result = buildTsQuery("'; DROP TABLE users; --")
      expect(result).not.toContain(";")
      expect(result).not.toContain("'")
      expect(result).not.toContain("--")
    })
  })

  describe.skipIf(skipMarketplaceIntegration())("Full-text search queries", () => {
    let ftsReady = false

    beforeAll(async () => {
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ col: string | null }>>(
          `SELECT attname AS col
           FROM pg_attribute a
           JOIN pg_class c ON a.attrelid = c.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE n.nspname = 'public'
             AND c.relname = 'ClawTemplate'
             AND a.attname = 'searchVector'
             AND NOT a.attisdropped`,
        )
        ftsReady = rows.length > 0
      } catch {
        ftsReady = false
      }
    })

    it("finds templates by name keyword", async () => {
      expect(ftsReady, "ClawTemplate.searchVector missing — apply Prisma migrations").toBe(true)
      const results = (await prisma.$queryRawUnsafe(
        `
        SELECT "id", "name", ts_rank_cd("searchVector", to_tsquery('english', 'quant:*')) AS rank
        FROM "ClawTemplate"
        WHERE "isPublished" = true
          AND "searchVector" @@ to_tsquery('english', 'quant:*')
        ORDER BY rank DESC
        LIMIT 5
      `,
      )) as Array<{ id: string; name: string; rank: number }>

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].name.toLowerCase()).toContain("quant")
    })

    it("finds templates by description keyword", async () => {
      expect(ftsReady, "ClawTemplate.searchVector missing — apply Prisma migrations").toBe(true)
      const results = (await prisma.$queryRawUnsafe(
        `
        SELECT "id", "name"
        FROM "ClawTemplate"
        WHERE "isPublished" = true
          AND "searchVector" @@ to_tsquery('english', 'sales:*')
        LIMIT 5
      `,
      )) as Array<{ id: string; name: string }>

      expect(results.length).toBeGreaterThan(0)
    })

    it("returns empty for nonexistent terms", async () => {
      expect(ftsReady, "ClawTemplate.searchVector missing — apply Prisma migrations").toBe(true)
      const results = (await prisma.$queryRawUnsafe(
        `
        SELECT "id"
        FROM "ClawTemplate"
        WHERE "isPublished" = true
          AND "searchVector" @@ to_tsquery('english', 'xyznonexistentterm123:*')
      `,
      )) as Array<{ id: string }>

      expect(results.length).toBe(0)
    })
  })
})
