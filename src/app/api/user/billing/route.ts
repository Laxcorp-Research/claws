import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      hasActiveSubscription: true,
      subscriptionStatus: true,
      subscriptionId: true,
      subscriptionEndsAt: true,
      trialUsed: true,
      trialStartedAt: true,
      trialEndsAt: true,
    },
  })
  if (!dbUser) return ERRORS.NOT_FOUND("user")

  const workspaces = await prisma.workspace.findMany({
    where: { userId: user.id },
    select: { status: true, currentMonthApiCost: true },
  })

  const activeStatuses = ["RUNNING", "PAUSED", "DEPLOYING", "ERROR"]
  const active = workspaces.filter((w) => activeStatuses.includes(w.status))
  const running = workspaces.filter((w) => w.status === "RUNNING").length
  const paused = workspaces.filter((w) => w.status === "PAUSED").length
  const totalCost = workspaces.reduce((sum, w) => sum + w.currentMonthApiCost, 0)

  const onHold = dbUser.subscriptionStatus === "on_hold"
  const plan = onHold ? "On hold" : dbUser.hasActiveSubscription ? "Active" : "Inactive"
  const planPrice = onHold
    ? "On hold - update your card"
    : dbUser.hasActiveSubscription
      ? "$79/mo per Claw"
      : "No active subscription"

  return apiSuccess({
    hasActiveSubscription: dbUser.hasActiveSubscription,
    subscriptionStatus: dbUser.subscriptionStatus,
    plan,
    planPrice,
    activeClaws: active.length,
    runningClaws: running,
    pausedClaws: paused,
    thisMonthTotal: Math.round(totalCost * 100) / 100,
    trialUsed: dbUser.trialUsed,
    trialStartedAt: dbUser.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: dbUser.trialEndsAt?.toISOString() ?? null,
    nextBillingDate: dbUser.subscriptionEndsAt ? dbUser.subscriptionEndsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : undefined,
  })
}
