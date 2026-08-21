/**
 * Pinned / recommended models.
 *
 * Anthropic: live GET https://api.anthropic.com/v1/models (platform master key)
 * owns the catalog; these three are the fallback flagship pins if refresh is
 * skipped. Daily cron re-pins the current Haiku/Sonnet/Opus equivalents from
 * the live list.
 *
 * OpenAI GET /v1/models and Google GET /v1beta/models exist but the platform
 * has no keys (BYOK-only) â€” pins below are the curated source; live refresh
 * when/if platform keys exist.
 *
 * OpenRouter rows here are the recommended subset; the daily cron also upserts
 * the full OpenRouter catalog (unpinned) for search.
 */
export type SeedModel = {
  modelId: string
  provider: "ANTHROPIC" | "OPENAI" | "GOOGLE" | "OPENROUTER"
  displayName: string
  contextLength?: number
  pricingSnippet?: string
  costPer1kEst?: number
  isPinned: boolean
  /** Adjustable thinking/reasoning support; omitted = unknown. */
  supportsReasoning?: boolean
}

export const PINNED_SEED_MODELS: SeedModel[] = [
  {
    modelId: "anthropic/claude-haiku-4-5-20251001",
    provider: "ANTHROPIC",
    displayName: "Claude Haiku 4.5",
    supportsReasoning: true,
    contextLength: 200000,
    pricingSnippet: "~$0.001/call est.",
    costPer1kEst: 0.001,
    isPinned: true,
  },
  {
    modelId: "anthropic/claude-sonnet-5",
    provider: "ANTHROPIC",
    displayName: "Claude Sonnet 5",
    supportsReasoning: true,
    contextLength: 1000000,
    isPinned: true,
  },
  {
    modelId: "anthropic/claude-opus-5",
    provider: "ANTHROPIC",
    displayName: "Claude Opus 5",
    supportsReasoning: true,
    contextLength: 1000000,
    isPinned: true,
  },
  {
    modelId: "openai/gpt-4o",
    provider: "OPENAI",
    displayName: "GPT-4o",
    supportsReasoning: false,
    contextLength: 128000,
    pricingSnippet: "~$0.025/call est.",
    costPer1kEst: 0.025,
    isPinned: true,
  },
  {
    modelId: "openai/gpt-4o-mini",
    provider: "OPENAI",
    displayName: "GPT-4o Mini",
    supportsReasoning: false,
    contextLength: 128000,
    pricingSnippet: "~$0.003/call est.",
    costPer1kEst: 0.003,
    isPinned: true,
  },
  {
    modelId: "google/gemini-2.5-pro",
    provider: "GOOGLE",
    displayName: "Gemini 2.5 Pro",
    supportsReasoning: true,
    contextLength: 1000000,
    pricingSnippet: "~$0.020/call est.",
    costPer1kEst: 0.02,
    isPinned: true,
  },
  // Cheap OpenRouter-routed options for live proof / BYOK discovery
  {
    modelId: "openrouter/openai/gpt-4o-mini",
    provider: "OPENROUTER",
    displayName: "GPT-4o Mini (via OpenRouter)",
    supportsReasoning: false,
    contextLength: 128000,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.003,
    isPinned: true,
  },
  {
    modelId: "openrouter/google/gemini-2.0-flash-001",
    provider: "OPENROUTER",
    displayName: "Gemini 2.0 Flash (via OpenRouter)",
    supportsReasoning: false,
    contextLength: 1000000,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.002,
    isPinned: true,
  },
  {
    modelId: "openrouter/meta-llama/llama-3.3-70b-instruct",
    provider: "OPENROUTER",
    displayName: "Llama 3.3 70B (via OpenRouter)",
    supportsReasoning: false,
    contextLength: 131072,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.004,
    isPinned: true,
  },
]
