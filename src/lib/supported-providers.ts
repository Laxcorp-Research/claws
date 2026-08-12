/**
 * Providers Claws accepts for user BYOK keys.
 * OPENROUTER is REAL (validation + runtime + selection). OLLAMA stays cut.
 */
export const SUPPORTED_PROVIDERS = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER"] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

/** Exact marketing/copy string for supported providers. */
export const SUPPORTED_PROVIDERS_COPY = "Anthropic, OpenAI, Google, and OpenRouter"

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
}

/** Map OpenClaw model ref prefix → ApiProvider for key eligibility. */
export function providerFromModelRef(model: string): SupportedProvider | null {
  const m = model || ""
  if (m.startsWith("openrouter/")) return "OPENROUTER"
  if (m.startsWith("anthropic/")) return "ANTHROPIC"
  if (m.startsWith("openai/")) return "OPENAI"
  if (m.startsWith("google/")) return "GOOGLE"
  return null
}
