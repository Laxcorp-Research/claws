import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { decrypt } from "@/lib/encryption"

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { provider } = body as { provider?: string }

  if (!provider) return ERRORS.VALIDATION("provider is required")

  const validProviders = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER", "OLLAMA"] as const
  type ValidProvider = typeof validProviders[number]
  if (!validProviders.includes(provider as ValidProvider)) return ERRORS.VALIDATION("Invalid provider")

  const key = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId: user.id, provider: provider as ValidProvider } },
  })
  if (!key) return ERRORS.NOT_FOUND("API key")

  let decryptedKey: string
  try {
    decryptedKey = decrypt(key.encryptedKey)
  } catch {
    await prisma.userApiKey.update({ where: { id: key.id }, data: { isValid: false, lastError: "Failed to decrypt key" } })
    return apiSuccess({ valid: false, error: "Failed to decrypt key" })
  }

  try {
    let valid = false

    if (provider === "ANTHROPIC") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": decryptedKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
      })
      valid = res.ok || res.status === 429
    } else if (provider === "OPENAI") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptedKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
      })
      valid = res.ok || res.status === 429
    } else if (provider === "GOOGLE") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${decryptedKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
      })
      valid = res.ok || res.status === 429
    } else {
      return apiError("UNSUPPORTED_PROVIDER", `Testing not supported for ${provider}`, 400)
    }

    await prisma.userApiKey.update({
      where: { id: key.id },
      data: { isValid: valid, lastUsedAt: new Date(), lastError: valid ? null : "API returned error" },
    })

    return apiSuccess({ valid, error: valid ? undefined : "API key is invalid or expired" })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Connection failed"
    await prisma.userApiKey.update({
      where: { id: key.id },
      data: { isValid: false, lastError: errorMsg },
    })
    return apiSuccess({ valid: false, error: errorMsg })
  }
}
