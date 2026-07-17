import { NextRequest, after } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"
import { onCreditsExhausted } from "@/lib/credits/exhaustion"
import { log } from "@/lib/logger"

interface UsageRecord {
  workspaceId: string
  agentId?: string
  model: string
  inputTokens: number
  outputTokens: number
  costCents: number
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("X-Metering-Secret")
  if (secret !== process.env.METERING_MASTER_SECRET) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  const { records, droppedCount } = await req.json()

  if (droppedCount > 0) {
    log.warn("Proxy dropped usage records", { droppedCount })
  }

  if (!Array.isArray(records) || records.length === 0) {
    return apiSuccess({ processed: 0 })
  }

  const workspaceIds = [...new Set((records as UsageRecord[]).map((r) => r.workspaceId))]
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: workspaceIds } },
    select: { id: true, userId: true },
  })
  const wsUserMap = new Map(workspaces.map((w) => [w.id, w.userId]))

  const byUser = new Map<string, UsageRecord[]>()
  for (const record of records as UsageRecord[]) {
    const userId = wsUserMap.get(record.workspaceId)
    if (!userId) continue
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId)!.push(record)
  }

  let totalProcessed = 0
  // Collect exhaustion side-effects outside the transaction; schedule via
  // after() so Vercel does not kill setImmediate/bare-promise work when the
  // response ends (same class as the dashboard wake fire-and-forget bug).
  const exhaustedUserIds: string[] = []

  for (const [userId, userRecords] of byUser) {
    const totalCost = userRecords.reduce((sum, r) => sum + (r.costCents || 0), 0)

    try {
      let exhausted = false
      await prisma.$transaction(async (tx) => {
        const account = await tx.creditAccount.findUnique({ where: { userId } })
        if (!account || account.status !== "ACTIVE") return

        const newBalance = Math.max(0, account.balanceCents - totalCost)

        await tx.creditAccount.update({
          where: { userId },
          data: {
            balanceCents: newBalance,
            totalConsumedCents: { increment: totalCost },
            status: newBalance === 0 ? "EXHAUSTED" : "ACTIVE",
            exhaustedAt: newBalance === 0 ? new Date() : undefined,
          },
        })

        await tx.creditUsageRecord.createMany({
          data: userRecords.map((r) => ({
            creditAccountId: account.id,
            workspaceId: r.workspaceId,
            agentId: r.agentId || null,
            provider: "ANTHROPIC" as const,
            model: r.model,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            costCents: r.costCents,
            balanceAfterCents: newBalance,
          })),
        })

        await redis.set(`credit:balance:${userId}`, newBalance.toString())
        await redis.decrby(`credit:reservations:${userId}`, totalCost)

        exhausted = newBalance === 0
      })

      if (exhausted) exhaustedUserIds.push(userId)
      totalProcessed += userRecords.length
    } catch (err) {
      log.error("Failed to process usage records", { userId, error: String(err) })
    }
  }

  for (const userId of exhaustedUserIds) {
    after(() =>
      onCreditsExhausted(userId).catch((err) => {
        log.error("onCreditsExhausted failed after report-batch", {
          userId,
          error: String(err),
        })
      }),
    )
  }

  return apiSuccess({ processed: totalProcessed })
}
