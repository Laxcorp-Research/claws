import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { queryModelCatalog } from "@/lib/models/catalog"

const NEW_PIN = {
  modelId: "anthropic/claude-sonnet-4-7",
  provider: "ANTHROPIC",
  displayName: "Claude Sonnet 4.7",
  contextLength: 200000,
  pricingSnippet: "~$0.015/call est.",
  costPer1kEst: 0.015,
  isPinned: true,
}

describe("queryModelCatalog registry → picker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("registry row added appears in catalog results (all providers)", async () => {
    prismaMock.modelCatalogEntry.findMany.mockResolvedValue([
      {
        modelId: "anthropic/claude-haiku-4-5-20251001",
        provider: "ANTHROPIC",
        displayName: "Claude Haiku 4.5",
        contextLength: 200000,
        pricingSnippet: null,
        costPer1kEst: 0.001,
        isPinned: true,
      },
      NEW_PIN,
    ] as never)

    const rows = await queryModelCatalog({ creditMode: true, pinnedOnly: true })
    expect(rows.map((r) => r.modelId)).toContain("anthropic/claude-sonnet-4-7")
    expect(rows.find((r) => r.modelId === NEW_PIN.modelId)?.displayName).toBe("Claude Sonnet 4.7")
  })

  it("creditMode does not drop OpenRouter rows (locked in UI, not hidden)", async () => {
    prismaMock.modelCatalogEntry.findMany.mockResolvedValue([
      NEW_PIN,
      {
        modelId: "openrouter/openai/gpt-4o-mini",
        provider: "OPENROUTER",
        displayName: "GPT-4o Mini",
        contextLength: 128000,
        pricingSnippet: "est.",
        costPer1kEst: 0.003,
        isPinned: true,
      },
    ] as never)

    const rows = await queryModelCatalog({ creditMode: true, limit: 50 })
    expect(rows.some((r) => r.provider === "OPENROUTER")).toBe(true)
  })

  it("allows a full-catalog take up to 2000", async () => {
    prismaMock.modelCatalogEntry.findMany.mockResolvedValue([] as never)
    await queryModelCatalog({ limit: 2000 })
    expect(prismaMock.modelCatalogEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2000 }),
    )
  })

  it("selects and passes supportsReasoning through to the picker payload", async () => {
    prismaMock.modelCatalogEntry.findMany.mockResolvedValue([
      { ...NEW_PIN, supportsReasoning: true },
    ] as never)
    const rows = await queryModelCatalog({ limit: 10 })
    expect(prismaMock.modelCatalogEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ supportsReasoning: true }),
      }),
    )
    expect(rows[0]?.supportsReasoning).toBe(true)
  })
})
