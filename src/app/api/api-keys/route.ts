import { NextRequest, after } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt, generateKeyHint } from "@/lib/encryption"
import { requestReconcileForUser } from "@/lib/openclaw/request-reconcile"

// PR-8b/C: headroom for after()'s fire-and-forget reconcile (E1 add/update BYOK
// key → reconcile the user's RUNNING containers). Gated by ENV_RECONCILE_MODE
// inside healWorkspace, so it's a no-op until the auto_heal flag-flip.
export const maxDuration = 30

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const keys = await prisma.userApiKey.findMany({
    where: { userId: user.id },
    select: {
      id: true, provider: true, keyHint: true, label: true,
      isValid: true, lastUsedAt: true, lastError: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })
  return apiSuccess(keys)
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { provider, apiKey, label } = body

  if (!provider || !apiKey) return ERRORS.VALIDATION("provider and apiKey are required")

  const validProviders = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER", "OLLAMA"]
  if (!validProviders.includes(provider)) return ERRORS.VALIDATION(`Invalid provider. Must be one of: ${validProviders.join(", ")}`)

  const existing = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId: user.id, provider } },
  })

  if (existing) {
    const updated = await prisma.userApiKey.update({
      where: { id: existing.id },
      data: { encryptedKey: encrypt(apiKey), keyHint: generateKeyHint(apiKey), label: label || existing.label, isValid: true, lastError: null },
      select: { id: true, provider: true, keyHint: true, label: true, isValid: true, createdAt: true },
    })
    after(() => requestReconcileForUser(user.id))
    return apiSuccess(updated)
  }

  const created = await prisma.userApiKey.create({
    data: { userId: user.id, provider, encryptedKey: encrypt(apiKey), keyHint: generateKeyHint(apiKey), label: label || null },
    select: { id: true, provider: true, keyHint: true, label: true, isValid: true, createdAt: true },
  })
  after(() => requestReconcileForUser(user.id))
  return apiSuccess(created, 201)
}
