/**
 * Providers Claws accepts for user BYOK keys.
 * Prisma enum may still include OPENROUTER/OLLAMA — those stay in schema but
 * are rejected at every save/UI surface (D1 2026-07-23).
 */
export const SUPPORTED_PROVIDERS = ["ANTHROPIC", "OPENAI", "GOOGLE"] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

/** Exact marketing/copy string for supported providers. */
export const SUPPORTED_PROVIDERS_COPY = "Anthropic, OpenAI, and Google"

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
}
