import { describe, expect, it } from "vitest"
import { humanizeModelId, looksLikeModelSlug, resolveCatalogDisplayName } from "@/lib/models/humanize"

describe("humanizeModelId", () => {
  it("never returns a slash-containing slug", () => {
    expect(humanizeModelId("anthropic/claude-sonnet-4-6")).toBe("Claude Sonnet 4.6")
    expect(humanizeModelId("openrouter/meta-llama/llama-3.3-70b-instruct")).toBe("Llama 3.3 70b Instruct")
    expect(humanizeModelId("anthropic/claude-sonnet-4-6")).not.toContain("/")
  })

  it("falls back to Unknown model for blanks", () => {
    expect(humanizeModelId("")).toBe("Unknown model")
  })
})

describe("resolveCatalogDisplayName", () => {
  it("keeps a human catalog name", () => {
    expect(resolveCatalogDisplayName("anthropic/claude-sonnet-5", "Claude Sonnet 5")).toBe("Claude Sonnet 5")
  })

  it("humanizes missing, blank, or slug display names", () => {
    expect(resolveCatalogDisplayName("openai/gpt-4o", null)).toBe("GPT 4o")
    expect(resolveCatalogDisplayName("openai/gpt-4o", "")).toBe("GPT 4o")
    expect(resolveCatalogDisplayName("openai/gpt-4o", "openai/gpt-4o")).toBe("GPT 4o")
    expect(looksLikeModelSlug(resolveCatalogDisplayName("openai/gpt-4o", "openai/gpt-4o"))).toBe(false)
  })
})
