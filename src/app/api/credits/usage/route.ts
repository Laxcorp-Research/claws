import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { buildDailyFromRecords, usageWindowStart } from "@/lib/credits/usage-ledger"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const account = await prisma.creditAccount.findUnique({
    where: { userId: user.id },
  })

  if (!account) return apiSuccess({ records: [], daily: [] })

  const windowStart = usageWindowStart()

  const [recentRecords, windowRecords] = await Promise.all([
    prisma.creditUsageRecord.findMany({
      where: { creditAccountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.creditUsageRecord.findMany({
      where: { creditAccountId: account.id, createdAt: { gte: windowStart } },
      select: {
        workspaceId: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        costCents: true,
        createdAt: true,
      },
    }),
  ])

  const daily = buildDailyFromRecords(windowRecords, account.id)

  const workspaceIds = [...new Set(recentRecords.map((r) => r.workspaceId))]
  const workspaces =
    workspaceIds.length === 0
      ? []
      : await prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, name: true },
        })
  const nameById = new Map(workspaces.map((w) => [w.id, w.name]))

  return apiSuccess({
    records: recentRecords.map((r) => ({
      ...r,
      workspaceName: nameById.get(r.workspaceId) ?? null,
    })),
    daily,
  })
}
