export const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GOOGLE: "Google",
  OPENROUTER: "OpenRouter",
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}
