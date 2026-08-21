/**
 * Single BYOK cost-honesty line for the model-selection table.
 * Per-row repetition is forbidden — render once under the table, only when relevant.
 */

export const BYOK_COST_DISCLAIMER =
  "BYOK models: cost figures are estimates — billed by your provider."

const BYOK_PROVIDERS = ["OPENAI", "GOOGLE", "OPENROUTER"] as const

export function isByokModelRef(model: string): boolean {
  return (
    model.startsWith("openai/") ||
    model.startsWith("google/") ||
    model.startsWith("openrouter/")
  )
}

/**
 * credit-mode + no BYOK keys/models → omit (credits banner already explains).
 * Any BYOK provider selected or available → show the single line.
 * Non-credit accounts are on their own keys → always show.
 */
export function shouldShowByokCostDisclaimer(params: {
  creditMode?: boolean
  configuredProviders?: string[]
  selectedModels?: string[]
}): boolean {
  const hasByokProvider = (params.configuredProviders ?? []).some((p) =>
    (BYOK_PROVIDERS as readonly string[]).includes(p),
  )
  const hasByokSelected = (params.selectedModels ?? []).some(isByokModelRef)
  if (params.creditMode) return hasByokProvider || hasByokSelected
  return true
}
