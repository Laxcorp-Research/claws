import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

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

  const sales = await prisma.marketplaceSale.findMany({
    where: { creatorId: profile.id },
    select: {
      amount: true,
      creatorPayout: true,
      payoutStatus: true,
      createdAt: true,
    },
  })

  const totalEarned = sales.reduce((sum, s) => sum + s.creatorPayout, 0)

  const pendingPayout = sales
    .filter((s) => s.payoutStatus === "PENDING" || s.payoutStatus === "RELEASABLE")
    .reduce((sum, s) => sum + s.creatorPayout, 0)

  const paidOut = sales
    .filter((s) => s.payoutStatus === "PAID")
    .reduce((sum, s) => sum + s.creatorPayout, 0)

  const oldestPending = sales
    .filter((s) => s.payoutStatus === "PENDING")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]

  const nextPayoutDate = oldestPending
    ? new Date(oldestPending.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const monthlyBreakdown: Record<string, number> = {}
  for (const sale of sales) {
    if (sale.createdAt >= sixMonthsAgo) {
      const month = sale.createdAt.toISOString().slice(0, 7)
      monthlyBreakdown[month] = (monthlyBreakdown[month] || 0) + sale.creatorPayout
    }
  }

  return apiSuccess({
    totalEarned: Math.round(totalEarned * 100) / 100,
    pendingPayout: Math.round(pendingPayout * 100) / 100,
    paidOut: Math.round(paidOut * 100) / 100,
    nextPayoutDate,
    totalSales: sales.length,
    monthlyBreakdown,
  })
}
