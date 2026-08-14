import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"
import { catalogToLegacyOptions } from "@/lib/models/catalog"
import { providerFromModelRef } from "@/lib/supported-providers"

describe("model catalog (OpenRouter arc)", () => {
  it("pinned seeds include native + OpenRouter recommended set", () => {
    expect(PINNED_SEED_MODELS.some((m) => m.provider === "ANTHROPIC")).toBe(true)
    expect(PINNED_SEED_MODELS.some((m) => m.modelId.startsWith("openrouter/"))).toBe(true)
  })

  it("maps catalog rows to picker options", () => {
    const opts = catalogToLegacyOptions([
      {
        modelId: "openrouter/openai/gpt-4o-mini",
        provider: "OPENROUTER",
        displayName: "GPT-4o Mini (via OpenRouter)",
        contextLength: 128000,
        pricingSnippet: "est.",
        costPer1kEst: 0.003,
        isPinned: true,
      },
    ])
    expect(opts[0]?.value).toBe("openrouter/openai/gpt-4o-mini")
    expect(opts[0]?.provider).toBe("OpenRouter")
  })

  it("providerFromModelRef maps openrouter prefix", () => {
    expect(providerFromModelRef("openrouter/openai/gpt-4o-mini")).toBe("OPENROUTER")
    expect(providerFromModelRef("anthropic/claude-sonnet-4-6")).toBe("ANTHROPIC")
  })

  it("MUTATION: generator emits OPENROUTER_API_KEY + openrouter baseUrl", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("OPENROUTER_API_KEY=")
    expect(src).toContain("https://openrouter.ai/api/v1")
    expect(src).toContain("case 'OPENROUTER'")
  })

  it("MUTATION: cron refresh-model-catalog is wired", () => {
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/refresh-model-catalog/route.ts"),
      "utf8",
    )
    expect(cron).toContain("refreshAllModelCatalogs")
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    expect(vercel).toContain("/api/cron/refresh-model-catalog")
  })

  it("MUTATION: OpenRouter validation uses /key not public /models alone", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/api-key-validation.ts"), "utf8")
    expect(src).toContain("openrouter.ai/api/v1/key")
  })

  it("MUTATION: creditMode gates catalog to Anthropic-only (platform meter)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).toContain("creditMode")
    expect(src).toMatch(/creditMode[\s\S]*provider\s*=\s*["']ANTHROPIC["']/)
    expect(src).toMatch(/creditMode\s*&&\s*s\.provider\s*!==\s*["']ANTHROPIC["']/)
  })

  it("native seed is exactly 9 pins (3 Anthropic + 2 OpenAI + 1 Google + 3 OpenRouter)", () => {
    expect(PINNED_SEED_MODELS).toHaveLength(9)
    expect(PINNED_SEED_MODELS.map((m) => m.modelId)).toEqual([
      "anthropic/claude-haiku-4-5-20251001",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-6",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "openrouter/openai/gpt-4o-mini",
      "openrouter/google/gemini-2.0-flash-001",
      "openrouter/meta-llama/llama-3.3-70b-instruct",
    ])
  })

  it("native refresh re-seeds pins only (no Anthropic/OpenAI/Google models API)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).toMatch(
      /export async function refreshNativeProviderLists[\s\S]*?return ensureSeedModels\(\)/,
    )
    expect(src).not.toMatch(/api\.anthropic\.com/)
    expect(src).not.toMatch(/api\.openai\.com/)
    expect(src).not.toMatch(/generativelanguage\.googleapis\.com/)
  })
})

