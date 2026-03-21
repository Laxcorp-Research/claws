import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

const PLAN_PRICES: Record<string, string> = {
  FREE: "$0/month",
  PRO: "$29/month",
  ENTERPRISE: "$99/month",
}

const PLAN_DISPLAY: Record<string, string> = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      subscriptionTier: true,
      subscriptionEndsAt: true,
    },
  })
  if (!dbUser) return ERRORS.NOT_FOUND("user")

  const tier = dbUser.subscriptionTier as string

  const workspaces = await prisma.workspace.findMany({
    where: { userId: user.id },
    select: { status: true, currentMonthApiCost: true },
  })

  const activeStatuses = ["RUNNING", "PAUSED", "DEPLOYING", "ERROR"]
  const active = workspaces.filter((w) => activeStatuses.includes(w.status))
  const running = workspaces.filter((w) => w.status === "RUNNING").length
  const paused = workspaces.filter((w) => w.status === "PAUSED").length
  const totalCost = workspaces.reduce((sum, w) => sum + w.currentMonthApiCost, 0)

  return apiSuccess({
    plan: PLAN_DISPLAY[tier] ?? tier,
    planPrice: PLAN_PRICES[tier] ?? "$0/month",
    activeClaws: active.length,
    runningClaws: running,
    pausedClaws: paused,
    thisMonthTotal: Math.round(totalCost * 100) / 100,
    nextBillingDate: dbUser.subscriptionEndsAt ? dbUser.subscriptionEndsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : undefined,
    isPastDue: false,
  })
}
