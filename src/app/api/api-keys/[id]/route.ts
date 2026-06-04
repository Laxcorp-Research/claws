import { NextRequest, after } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { requestReconcileForUser } from "@/lib/openclaw/request-reconcile"

// PR-8b/C: headroom for after()'s fire-and-forget reconcile (E2 remove BYOK key).
export const maxDuration = 30

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const key = await prisma.userApiKey.findFirst({ where: { id, userId: user.id } })
  if (!key) return ERRORS.NOT_FOUND("API key")

  await prisma.userApiKey.delete({ where: { id } })
  // PR-8b/C (E2): reconcile the user's RUNNING containers after key removal.
  after(() => requestReconcileForUser(user.id))
  return apiSuccess({ deleted: true })
}
