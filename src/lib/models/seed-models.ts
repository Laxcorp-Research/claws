/**
 * Pinned / recommended models — always present; render first in pickers.
 * Native Anthropic/OpenAI/Google stay as direct providers; OpenRouter models
 * use openrouter/<openrouter-id> refs for the runtime.
 */
export type SeedModel = {
  modelId: string
  provider: "ANTHROPIC" | "OPENAI" | "GOOGLE" | "OPENROUTER"
  displayName: string
  contextLength?: number
  pricingSnippet?: string
  costPer1kEst?: number
  isPinned: boolean
}

export const PINNED_SEED_MODELS: SeedModel[] = [
  {
    modelId: "anthropic/claude-haiku-4-5-20251001",
    provider: "ANTHROPIC",
    displayName: "Claude Haiku 4.5",
    contextLength: 200000,
    pricingSnippet: "~$0.001/call est.",
    costPer1kEst: 0.001,
    isPinned: true,
  },
  {
    modelId: "anthropic/claude-sonnet-4-6",
    provider: "ANTHROPIC",
    displayName: "Claude Sonnet 4.6",
    contextLength: 200000,
    pricingSnippet: "~$0.015/call est.",
    costPer1kEst: 0.015,
    isPinned: true,
  },
  {
    modelId: "anthropic/claude-opus-4-6",
    provider: "ANTHROPIC",
    displayName: "Claude Opus 4.6",
    contextLength: 200000,
    pricingSnippet: "~$0.075/call est.",
    costPer1kEst: 0.075,
    isPinned: true,
  },
  {
    modelId: "openai/gpt-4o",
    provider: "OPENAI",
    displayName: "GPT-4o",
    contextLength: 128000,
    pricingSnippet: "~$0.025/call est.",
    costPer1kEst: 0.025,
    isPinned: true,
  },
  {
    modelId: "openai/gpt-4o-mini",
    provider: "OPENAI",
    displayName: "GPT-4o Mini",
    contextLength: 128000,
    pricingSnippet: "~$0.003/call est.",
    costPer1kEst: 0.003,
    isPinned: true,
  },
  {
    modelId: "google/gemini-2.5-pro",
    provider: "GOOGLE",
    displayName: "Gemini 2.5 Pro",
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
    contextLength: 128000,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.003,
    isPinned: true,
  },
  {
    modelId: "openrouter/google/gemini-2.0-flash-001",
    provider: "OPENROUTER",
    displayName: "Gemini 2.0 Flash (via OpenRouter)",
    contextLength: 1000000,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.002,
    isPinned: true,
  },
  {
    modelId: "openrouter/meta-llama/llama-3.3-70b-instruct",
    provider: "OPENROUTER",
    displayName: "Llama 3.3 70B (via OpenRouter)",
    contextLength: 131072,
    pricingSnippet: "OpenRouter est.",
    costPer1kEst: 0.004,
    isPinned: true,
  },
]
