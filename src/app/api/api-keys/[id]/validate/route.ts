import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { decrypt } from "@/lib/encryption"

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

const validators: Record<string, (key: string) => Promise<{ valid: boolean; error?: string }>> = {
  ANTHROPIC: validateAnthropicKey,
  OPENAI: validateOpenAIKey,
  GOOGLE: validateGoogleKey,
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const key = await prisma.userApiKey.findFirst({ where: { id, userId: user.id } })
  if (!key) return ERRORS.NOT_FOUND("API key")

  const validator = validators[key.provider]
  if (!validator) {
    await prisma.userApiKey.update({ where: { id }, data: { isValid: true, lastUsedAt: new Date(), lastError: null } })
    return apiSuccess({ valid: true, provider: key.provider })
  }

  const plainKey = decrypt(key.encryptedKey)
  const result = await validator(plainKey)

  await prisma.userApiKey.update({
    where: { id },
    data: { isValid: result.valid, lastUsedAt: new Date(), lastError: result.error || null },
  })
  return apiSuccess({ valid: result.valid, error: result.error, provider: key.provider })
}
