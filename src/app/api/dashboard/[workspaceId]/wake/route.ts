import { NextRequest, after } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { wakeWorkspace } from "@/lib/hibernation/manager"
import { canWakeHibernatedWorkspace } from "@/lib/trial/wake-entitlement"

export const maxDuration = 300

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      containerState: true,
      user: {
        select: {
          trialUsed: true,
          trialStartedAt: true,
          trialEndsAt: true,
          hasActiveSubscription: true,
          subscriptionStatus: true,
          subscriptionOnHoldAt: true,
        },
      },
    },
  })

  if (!workspace) return ERRORS.NOT_FOUND("Workspace")
  if (workspace.userId !== user.id) return ERRORS.FORBIDDEN()

  if (workspace.status !== "HIBERNATED") {
    return apiError("INVALID_STATE", `Cannot wake workspace in ${workspace.status} state`, 400)
  }

  const entitlement = canWakeHibernatedWorkspace(workspace.user)
  if (!entitlement.allowed) {
    return apiError(
      "SUBSCRIPTION_REQUIRED",
      "Your 3-day trial has ended. Subscribe to the Claw Platform ($79/mo) to wake this Claw.",
      402,
    )
  }

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "WAKING" },
    }),
    prisma.containerState.update({
      where: { workspaceId },
      data: { containerPhase: "WAKING", wakeRequestedAt: new Date() },
    }),
  ])

  // after() keeps wakeWorkspace alive after the HTTP response (Vercel would
  // otherwise kill a bare promise). Route still returns immediately for the
  // Waking… UX. Fallback: cron/hibernation STUCK WAKING RECOVERY retries
  // containerPhase=WAKING with wakeRequestedAt older than 5m
  // (src/app/api/cron/hibernation/route.ts).
  after(() =>
    wakeWorkspace(workspaceId).catch((err) => {
      log.error("Dashboard wake async failed; hibernation cron stuck-WAKING recovery retries after 5m", {
        workspaceId,
        error: String(err),
      })
    }),
  )

  return apiSuccess({ status: "WAKING" })
}
