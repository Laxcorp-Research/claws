import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { log } from "@/lib/logger"
import { accountDeletionPurgeAt } from "@/lib/trial/lifecycle-followups"

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { name, email, onboardingCompleted } = body as { name?: string; email?: string; onboardingCompleted?: boolean }

  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name
  if (email !== undefined) {
    if (!email || !email.includes("@")) return ERRORS.VALIDATION("Invalid email address")
    const existing = await prisma.user.findFirst({ where: { email, id: { not: user.id } } })
    if (existing) return ERRORS.VALIDATION("Email already in use")
    updateData.email = email
  }
  if (onboardingCompleted !== undefined) updateData.onboardingCompleted = onboardingCompleted === true
  if ((body as { cancelAccountDeletion?: boolean }).cancelAccountDeletion === true) {
    updateData.deletionRequestedAt = null
  }

  if (Object.keys(updateData).length === 0) return ERRORS.VALIDATION("No fields to update")

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
    select: { id: true, name: true, email: true, avatarUrl: true },
  })

  return apiSuccess({ user: { id: updated.id, name: updated.name, email: updated.email, image: updated.avatarUrl } })
}

export async function DELETE() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  // 14-day grace. The daily account-retention cron tears containers down
  // and then deletes the user. Immediate user.delete orphaned live Railway
  // services; that teardown now lives on the cron, after the grace.
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { deletionRequestedAt: true },
  })
  if (existing?.deletionRequestedAt) {
    return apiSuccess({
      scheduled: true,
      deletionRequestedAt: existing.deletionRequestedAt,
      purgeAt: accountDeletionPurgeAt(existing.deletionRequestedAt),
    })
  }

  const deletionRequestedAt = new Date()
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt },
  })
  log.info("account deletion scheduled", { userId: user.id })
  return apiSuccess({
    scheduled: true,
    deletionRequestedAt,
    purgeAt: accountDeletionPurgeAt(deletionRequestedAt),
  })
}
