import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { creditUsageRetentionCutoff } from "@/lib/credits/usage-retention"

export const maxDuration = 60

function startOfDayUTC(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const yesterday = startOfDayUTC(new Date(Date.now() - 86400000))
  let totalAggregated = 0

  const oldest = await prisma.creditUsageRecord.findFirst({
    where: { createdAt: { lt: yesterday } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  })

  if (!oldest) {
    log.info("No credit usage records to aggregate")
    return Response.json({ success: true, data: { aggregated: 0, deleted: 0 } })
  }

  let currentDay = startOfDayUTC(oldest.createdAt)

  while (currentDay < yesterday) {
    const nextDay = addDays(currentDay, 1)

    const records = await prisma.creditUsageRecord.groupBy({
      by: ["creditAccountId", "workspaceId", "provider", "model"],
      where: {
        createdAt: { gte: currentDay, lt: nextDay },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        costCents: true,
      },
      _count: true,
    })

    for (const r of records) {
      try {
        await prisma.creditUsageDaily.upsert({
          where: {
            creditAccountId_workspaceId_date_provider_model: {
              creditAccountId: r.creditAccountId,
              workspaceId: r.workspaceId,
              date: currentDay,
              provider: r.provider,
              model: r.model,
            },
          },
          // SET absolute day totals (not increment) — re-runs / overlapping
          // windows must not double-count into CreditUsageDaily.
          update: {
            totalCalls: r._count,
            totalInputTokens: r._sum.inputTokens ?? 0,
            totalOutputTokens: r._sum.outputTokens ?? 0,
            totalCostCents: r._sum.costCents ?? 0,
          },
          create: {
            creditAccountId: r.creditAccountId,
            workspaceId: r.workspaceId,
            date: currentDay,
            provider: r.provider,
            model: r.model,
            totalCalls: r._count,
            totalInputTokens: r._sum.inputTokens ?? 0,
            totalOutputTokens: r._sum.outputTokens ?? 0,
            totalCostCents: r._sum.costCents ?? 0,
          },
        })
      } catch (err) {
        log.error("Usage aggregation upsert failed", {
          creditAccountId: r.creditAccountId,
          date: currentDay.toISOString(),
          error: String(err),
        })
      }
    }

    totalAggregated += records.length
    currentDay = nextDay
  }

  const retentionCutoff = creditUsageRetentionCutoff()
  const deleted = await prisma.creditUsageRecord.deleteMany({
    where: { createdAt: { lt: retentionCutoff } },
  })

  log.info("Credit usage aggregation complete", {
    aggregated: totalAggregated,
    deleted: deleted.count,
  })

  return Response.json({
    success: true,
    data: { aggregated: totalAggregated, deleted: deleted.count },
  })
}
