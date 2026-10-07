import { isSelfHost } from "@/lib/profile"

async function validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    })
    if (res.ok) return { valid: true }
    if (res.status === 401) return { valid: false, error: "Invalid API key" }
    if (res.status === 403) return { valid: false, error: "API key lacks permission" }
    const data = await res.json().catch(() => null)
    if (res.status === 400 && data?.error?.type === "invalid_request_error") return { valid: true }
    return { valid: false, error: `Unexpected response: ${res.status}` }
  } catch { return { valid: false, error: "Could not reach Anthropic API" } }
}

async function validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } })
    if (res.ok) return { valid: true }
    if (res.status === 401) return { valid: false, error: "Invalid API key" }
    return { valid: false, error: `Unexpected response: ${res.status}` }
  } catch { return { valid: false, error: "Could not reach OpenAI API" } }
}

async function validateGoogleKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`)
    if (res.ok) return { valid: true }
    return { valid: false, error: "Invalid API key" }
  } catch { return { valid: false, error: "Could not reach Google AI API" } }
}

/**
 * OpenRouter: GET /models is PUBLIC (200 even with a bad key) - do NOT use it alone.
 * Real credential check = GET /api/v1/key (401 on invalid). Catalog stays /models.
 */
async function validateOpenRouterKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) return { valid: true }
    if (res.status === 401) return { valid: false, error: "Invalid API key" }
    if (res.status === 403) return { valid: false, error: "API key lacks permission" }
    return { valid: false, error: `Unexpected response: ${res.status}` }
  } catch {
    return { valid: false, error: "Could not reach OpenRouter API" }
  }
}

const validators: Record<string, (key: string) => Promise<{ valid: boolean; error?: string }>> = {
  ANTHROPIC: validateAnthropicKey,
  OPENAI: validateOpenAIKey,
  GOOGLE: validateGoogleKey,
  OPENROUTER: validateOpenRouterKey,
}

export async function validateApiKey(provider: string, plainKey: string): Promise<{ valid: boolean; error?: string }> {
  const validator = validators[provider]
  // MUTATION: returning { valid: true } here → "rejects provider with no validator" fails.
  if (!validator) {
    return { valid: false, error: `Unsupported provider: ${provider}` }
  }
  if (isSelfHost() && plainKey.startsWith("fixture-")) {
    return { valid: true }
  }
  return validator(plainKey)
}
