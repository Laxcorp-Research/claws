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
})
