/**
 * Static pinned fallbacks + helpers.
 * Live catalog lives in ModelCatalogEntry (see src/lib/models/catalog.ts).
 * AI_MODELS is derived from PINNED_SEED_MODELS natives — do not hardcode a
 * second list. Adding a native pin is a one-line change in seed-models.ts.
 */
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"

const NATIVE_PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GOOGLE: "Google",
}

function nativeTier(modelId: string): "fast" | "balanced" | "powerful" {
  if (modelId.includes("haiku") || modelId.includes("mini")) return "fast"
  if (modelId.includes("opus")) return "powerful"
  return "balanced"
}

export const AI_MODELS = PINNED_SEED_MODELS.filter((m) => m.provider !== "OPENROUTER").map((m) => ({
  value: m.modelId,
  label: m.displayName,
  provider: NATIVE_PROVIDER_LABEL[m.provider] ?? m.provider,
  tier: nativeTier(m.modelId),
  costPer1kCalls: m.costPer1kEst ?? 0.015,
}))

export type AIModelValue = (typeof AI_MODELS)[number]["value"]

export const DEFAULT_MODEL: Record<string, string> = {
  ORCHESTRATOR: "anthropic/claude-haiku-4-5-20251001",
  WORKER: "anthropic/claude-sonnet-4-6",
  CRITIC: "anthropic/claude-opus-4-6",
}

export function getModelLabel(value: string): string {
  return PINNED_SEED_MODELS.find((m) => m.modelId === value)?.displayName ?? value
}

export function getModelCost(value: string): number {
  return PINNED_SEED_MODELS.find((m) => m.modelId === value)?.costPer1kEst ?? 0.015
}
