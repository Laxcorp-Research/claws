import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  pickAnthropicFlagshipPins,
  refreshAnthropicCatalog,
  type AnthropicModelInfo,
} from "@/lib/models/anthropic-catalog"

/** Verbatim ids from GET /v1/models 2026-08-14 (newest first, has_more=false). */
const LIVE_ANTHROPIC_MODELS: AnthropicModelInfo[] = [
  { id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-07-24T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-sonnet-5", display_name: "Claude Sonnet 5", created_at: "2026-06-29T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-fable-5", display_name: "Claude Fable 5", created_at: "2026-06-07T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-05-28T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-opus-4-7", display_name: "Claude Opus 4.7", created_at: "2026-04-14T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2026-02-17T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", created_at: "2026-02-04T00:00:00Z", max_input_tokens: 1000000 },
  { id: "claude-opus-4-5-20251101", display_name: "Claude Opus 4.5", created_at: "2025-11-24T00:00:00Z", max_input_tokens: 200000 },
  { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", created_at: "2025-10-15T00:00:00Z", max_input_tokens: 200000 },
  { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5", created_at: "2025-09-29T00:00:00Z", max_input_tokens: 1000000 },
]

describe("pickAnthropicFlagshipPins", () => {
  it("pins current Haiku/Sonnet/Opus equivalents from the live newest-first list", () => {
    const pins = pickAnthropicFlagshipPins(LIVE_ANTHROPIC_MODELS)
    expect(pins.haiku?.id).toBe("claude-haiku-4-5-20251001")
    expect(pins.sonnet?.id).toBe("claude-sonnet-5")
    expect(pins.opus?.id).toBe("claude-opus-5")
  })
})

describe("refreshAnthropicCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-test-master")
    ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
    )
    prismaMock.modelCatalogEntry.upsert.mockImplementation((async ({
      where,
      create,
    }: {
      where: { modelId: string }
      create: Record<string, unknown>
    }) => ({
      id: "row",
      ...create,
      modelId: where.modelId,
    })) as never)
    prismaMock.modelCatalogEntry.updateMany.mockResolvedValue({ count: 0 } as never)
  })

  it("upserts every live id and pins the flagship trio", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: { headers?: Record<string, string> }) => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: LIVE_ANTHROPIC_MODELS,
          has_more: false,
          last_id: "claude-sonnet-4-5-20250929",
        }),
      }),
    )

    const result = await refreshAnthropicCatalog(fetcher)

    expect(fetcher).toHaveBeenCalled()
    const url = String(fetcher.mock.calls[0]?.[0])
    expect(url).toContain("https://api.anthropic.com/v1/models")
    expect(result.fetched).toBe(10)
    expect(result.upserted).toBe(10)
    expect(result.pinned).toEqual([
      "anthropic/claude-haiku-4-5-20251001",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5",
    ])

    const upsertedIds = prismaMock.modelCatalogEntry.upsert.mock.calls.map(
      (c) => c[0]?.where?.modelId,
    )
    expect(upsertedIds).toContain("anthropic/claude-opus-5")
    expect(upsertedIds).toContain("anthropic/claude-fable-5")
    expect(upsertedIds).toContain("anthropic/claude-opus-4-8")

    const opus5 = prismaMock.modelCatalogEntry.upsert.mock.calls.find(
      (c) => c[0]?.where?.modelId === "anthropic/claude-opus-5",
    )?.[0]
    expect(opus5?.create?.isPinned).toBe(true)
    expect(opus5?.create?.costPer1kEst).toBeNull()

    const opus48 = prismaMock.modelCatalogEntry.upsert.mock.calls.find(
      (c) => c[0]?.where?.modelId === "anthropic/claude-opus-4-8",
    )?.[0]
    expect(opus48?.create?.isPinned).toBe(false)
    expect(opus48?.create?.costPer1kEst).toBeNull()
  })

  it("backfills a human displayName when Anthropic omits display_name", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "claude-mystery-9", display_name: "", created_at: "2026-01-01T00:00:00Z" }],
        has_more: false,
      }),
    }))
    await refreshAnthropicCatalog(fetcher)
    const row = prismaMock.modelCatalogEntry.upsert.mock.calls.find(
      (c) => c[0]?.where?.modelId === "anthropic/claude-mystery-9",
    )?.[0]
    expect(row?.create?.displayName).toBe("Claude Mystery 9")
    expect(String(row?.create?.displayName)).not.toContain("/")
  })
})
