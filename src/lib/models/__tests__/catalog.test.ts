import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"
import {
  catalogToLegacyOptions,
  derivedNativeFromOpenRouter,
  isTextOnlyChatModel,
  reasoningFromOpenRouter,
} from "@/lib/models/catalog"
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
        supportsReasoning: false,
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
    // D6 2026-08-23 webchat-silent: emission is map-driven (provider →
    // env name) and resolves WorkspaceApiKey overrides before user keys.
    // Dropping either the OpenRouter mapping or the override read fails here.
    expect(src).toContain("OPENROUTER: 'OPENROUTER_API_KEY'")
    expect(src).toContain("https://openrouter.ai/api/v1")
    expect(src).toContain("apiKeyOverrides")
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

  it("MUTATION: creditMode must not hide non-Anthropic catalog rows", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).not.toMatch(/if \(params\.creditMode\) \{\s*where\.provider = ["']ANTHROPIC["']/)
    expect(src).not.toMatch(/creditMode && s\.provider !== ["']ANTHROPIC["']/)
    expect(src).toContain("MODEL_CATALOG_MAX_LIMIT")
  })

  it("native seed is 9 pins (3 Anthropic flagship fallbacks + 2 OpenAI + 1 Google + 3 OpenRouter)", () => {
    expect(PINNED_SEED_MODELS).toHaveLength(9)
    expect(PINNED_SEED_MODELS.map((m) => m.modelId)).toEqual([
      "anthropic/claude-haiku-4-5-20251001",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "openrouter/openai/gpt-4o-mini",
      "openrouter/google/gemini-2.0-flash-001",
      "openrouter/meta-llama/llama-3.3-70b-instruct",
    ])
  })

  it("derives native OPENAI/GOOGLE rows from OpenRouter ids (founder Q1: full native lists)", () => {
    expect(derivedNativeFromOpenRouter({ id: "openai/gpt-4o" })).toEqual({
      modelId: "openai/gpt-4o",
      provider: "OPENAI",
    })
    expect(derivedNativeFromOpenRouter({ id: "google/gemini-2.5-pro" })).toEqual({
      modelId: "google/gemini-2.5-pro",
      provider: "GOOGLE",
    })
  })

  it("does NOT derive natives for variants, Anthropic, or other vendors", () => {
    // :variants are OpenRouter-only routes - not callable with a native key.
    expect(derivedNativeFromOpenRouter({ id: "openai/gpt-4o:extended" })).toBeNull()
    expect(derivedNativeFromOpenRouter({ id: "google/gemini-2.0-flash-001:free" })).toBeNull()
    // Anthropic natives come from the live Anthropic /v1/models refresh only.
    expect(derivedNativeFromOpenRouter({ id: "anthropic/claude-sonnet-5" })).toBeNull()
    expect(derivedNativeFromOpenRouter({ id: "meta-llama/llama-3.3-70b-instruct" })).toBeNull()
  })

  it("MUTATION: derived-native upserts dropped from OpenRouter refresh → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).toContain("derivedNativeFromOpenRouter")
    expect(src).toContain("openrouter-derived")
    expect(src).toContain("stripVendorPrefix")
  })

  it("reasoningFromOpenRouter reads supported_parameters (founder: per-model effort)", () => {
    expect(
      reasoningFromOpenRouter({ id: "x", supported_parameters: ["temperature", "reasoning"] }),
    ).toBe(true)
    expect(
      reasoningFromOpenRouter({ id: "x", supported_parameters: ["include_reasoning"] }),
    ).toBe(true)
    expect(
      reasoningFromOpenRouter({ id: "x", supported_parameters: ["temperature", "top_p"] }),
    ).toBe(false)
    // Missing metadata = unknown, never false: the UI must not lock the control.
    expect(reasoningFromOpenRouter({ id: "x" })).toBeNull()
  })

  it("isTextOnlyChatModel keeps chat models, culls audio/image-output rows (founder ruling)", () => {
    // Real staging-census fixtures, 2026-08-21.
    expect(
      isTextOnlyChatModel({ id: "openai/gpt-audio", architecture: { output_modalities: ["text", "audio"] } }),
    ).toBe(false)
    expect(
      isTextOnlyChatModel({ id: "google/lyria-3-pro-preview", architecture: { output_modalities: ["text", "audio"] } }),
    ).toBe(false)
    expect(
      isTextOnlyChatModel({ id: "google/gemini-2.5-flash-image", architecture: { output_modalities: ["image", "text"] } }),
    ).toBe(false)
    expect(
      isTextOnlyChatModel({ id: "openrouter/auto", architecture: { output_modalities: ["text", "image"] } }),
    ).toBe(false)
    // Vision INPUT chat models reply in text - they stay.
    expect(
      isTextOnlyChatModel({
        id: "openai/gpt-4o",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      }),
    ).toBe(true)
    // Legacy modality-string fallback.
    expect(isTextOnlyChatModel({ id: "x", architecture: { modality: "text+image->text" } })).toBe(true)
    expect(isTextOnlyChatModel({ id: "x", architecture: { modality: "text->text+image" } })).toBe(false)
    // Missing metadata = keep. Never over-delete on unknown.
    expect(isTextOnlyChatModel({ id: "x" })).toBe(true)
    expect(isTextOnlyChatModel({ id: "x", architecture: { output_modalities: [] } })).toBe(true)
  })

  it("MUTATION: isActive decoupled from the text-only classifier → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).toContain("const textChat = isTextOnlyChatModel(m)")
    // Both the OpenRouter row and its derived-native twin write it (create+update each).
    expect((src.match(/isActive: textChat/g) ?? []).length).toBe(4)
  })

  it("MUTATION: supportsReasoning dropped from refresh or seed writes → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    expect(src).toContain("const supportsReasoning = reasoningFromOpenRouter(m)")
    expect(src).toContain("supportsReasoning: seed.supportsReasoning ?? null")
    // Both the OpenRouter row and its derived-native twin persist the flag
    // (create+update each), plus 2 seed writes and the query select.
    expect((src.match(/supportsReasoning/g) ?? []).length).toBeGreaterThanOrEqual(8)
    const anthropic = readFileSync(
      join(process.cwd(), "src/lib/models/anthropic-catalog.ts"),
      "utf8",
    )
    expect(anthropic).toContain("anthropicSupportsReasoning(m.id)")
  })

  it("MUTATION: refresh-returns-pins-only restored → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/models/catalog.ts"), "utf8")
    const anthropic = readFileSync(
      join(process.cwd(), "src/lib/models/anthropic-catalog.ts"),
      "utf8",
    )
    expect(src).toContain("refreshAnthropicCatalog")
    expect(src).not.toMatch(
      /export async function refreshNativeProviderLists[\s\S]*?return ensureSeedModels\(\)\s*\}/,
    )
    expect(anthropic).toContain("https://api.anthropic.com/v1/models")
    expect(anthropic).toContain("CLAWS_MASTER_ANTHROPIC_KEY")
  })
})

