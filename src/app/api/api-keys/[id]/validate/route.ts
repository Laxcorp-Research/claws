import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { decrypt } from "@/lib/encryption"
import { validateApiKey } from "@/lib/api-key-validation"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const key = await prisma.userApiKey.findFirst({ where: { id, userId: user.id } })
  if (!key) return ERRORS.NOT_FOUND("API key")

  const plainKey = decrypt(key.encryptedKey)
  const result = await validateApiKey(key.provider, plainKey)

  await prisma.userApiKey.update({
    where: { id },
    data: { isValid: result.valid, lastUsedAt: new Date(), lastError: result.error || null },
  })
  return apiSuccess({ valid: result.valid, error: result.error, provider: key.provider })
}
