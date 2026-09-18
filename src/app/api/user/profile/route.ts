import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { destroyContainer } from "@/lib/openclaw/deployer"
import { log } from "@/lib/logger"

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

  // ToS-truth fix: the bare user.delete cascaded Workspace rows away while
  // their LIVE containers kept running - orphaned Railway services with the
  // user's keys aboard, unreachable by every cron (they all join through
  // Workspace). Tear each container down FIRST (recycles into the service
  // pool; best-effort per workspace - a Railway hiccup must not strand the
  // deletion, the pool sweeper owns stragglers).
  // MUTATION: remove this loop → account-deletion orphan test fails.
  const workspaces = await prisma.workspace.findMany({
    where: { userId: user.id, containerId: { not: null } },
    select: { id: true },
  })
  for (const ws of workspaces) {
    try {
      await destroyContainer(ws.id)
    } catch (err) {
      log.error("account deletion: container teardown failed (continuing)", {
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await prisma.user.delete({ where: { id: user.id } })
  return apiSuccess({ deleted: true })
}
