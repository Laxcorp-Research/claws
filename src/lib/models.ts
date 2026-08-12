/**
 * Static pinned fallbacks + helpers.
 * Live catalog lives in ModelCatalogEntry (see src/lib/models/catalog.ts).
 * AI_MODELS kept for backward-compat imports; mirrors PINNED_SEED_MODELS natives.
 */
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"

export const AI_MODELS = [
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "Anthropic", tier: "fast", costPer1kCalls: 0.001 },
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "Anthropic", tier: "balanced", costPer1kCalls: 0.015 },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", provider: "Anthropic", tier: "powerful", costPer1kCalls: 0.075 },
  { value: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI", tier: "balanced", costPer1kCalls: 0.025 },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI", tier: "fast", costPer1kCalls: 0.003 },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google", tier: "balanced", costPer1kCalls: 0.020 },
] as const

export type AIModelValue = (typeof AI_MODELS)[number]["value"]

export const DEFAULT_MODEL: Record<string, AIModelValue> = {
  ORCHESTRATOR: "anthropic/claude-haiku-4-5-20251001",
  WORKER: "anthropic/claude-sonnet-4-6",
  CRITIC: "anthropic/claude-opus-4-6",
}

export function getModelLabel(value: string): string {
  const fromStatic = AI_MODELS.find((m) => m.value === value)?.label
  if (fromStatic) return fromStatic
  const seed = PINNED_SEED_MODELS.find((m) => m.modelId === value)
  return seed?.displayName ?? value
}

export function getModelCost(value: string): number {
  const fromStatic = AI_MODELS.find((m) => m.value === value)?.costPer1kCalls
  if (fromStatic !== undefined) return fromStatic
  const seed = PINNED_SEED_MODELS.find((m) => m.modelId === value)
  return seed?.costPer1kEst ?? 0.015
}
