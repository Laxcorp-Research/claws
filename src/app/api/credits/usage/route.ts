import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const account = await prisma.creditAccount.findUnique({
    where: { userId: user.id },
  })

  if (!account) return apiSuccess({ records: [], daily: [] })

  const recentRecords = await prisma.creditUsageRecord.findMany({
    where: { creditAccountId: account.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  const dailyAggregates = await prisma.creditUsageDaily.findMany({
    where: { creditAccountId: account.id },
    orderBy: { date: "desc" },
    take: 30,
  })

  return apiSuccess({
    records: recentRecords,
    daily: dailyAggregates,
  })
}
