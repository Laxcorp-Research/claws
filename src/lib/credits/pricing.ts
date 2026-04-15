const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-haiku-4-5": { inputPer1M: 100, outputPer1M: 500 },
  "claude-sonnet-4-6": { inputPer1M: 300, outputPer1M: 1500 },
  "claude-opus-4-6": { inputPer1M: 1500, outputPer1M: 7500 },
}

export const CREDIT_ELIGIBLE_MODELS = Object.keys(MODEL_PRICING)

const DEFAULT_PRICING = MODEL_PRICING["claude-sonnet-4-6"]

export function calculateActualCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING
  const inputCost = Math.ceil((inputTokens / 1_000_000) * pricing.inputPer1M)
  const outputCost = Math.ceil((outputTokens / 1_000_000) * pricing.outputPer1M)
  return inputCost + outputCost
}

export function estimateCallCost(model: string, estimatedInputTokens: number): number {
  return calculateActualCost(model, estimatedInputTokens, estimatedInputTokens * 2)
}
