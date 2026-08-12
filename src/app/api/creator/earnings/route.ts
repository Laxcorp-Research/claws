import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { prisma } from "@/lib/db"
import { getCreatorEarnings } from "@/lib/marketplace/payouts"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!profile) {
    return apiError("NOT_ENROLLED", "Not enrolled as creator", 403)
  }

  const earnings = await getCreatorEarnings(profile.id)

  return apiSuccess({
    totalEarned: earnings.totalEarned,
    pendingHold: earnings.pendingHold,
    releasablePayout: earnings.releasablePayout,
    pendingPayout: earnings.pendingPayout,
    processingPayout: earnings.processingPayout,
    paidOut: earnings.paidOut,
    nextPayoutDate: earnings.nextPayoutDate?.toISOString() ?? null,
    totalSales: earnings.totalSales,
    lifecycleCopy: earnings.lifecycleCopy,
    recentSales: earnings.recentSales.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
  })
}
