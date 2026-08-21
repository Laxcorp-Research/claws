import { NextRequest, after } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"
import { onCreditsExhausted } from "@/lib/credits/exhaustion"
import { log } from "@/lib/logger"
import {
  METERING_SECRET_HEADER,
  proxyReportBatchBodySchema,
  type ProxyUsageRecord,
} from "@/lib/credits/proxy-metering-payload"
import { usageRecordIdempotencyKey } from "@/lib/credits/usage-idempotency"
import { PRE_INSTRUMENTATION_NOTE_EVENT_KIND } from "@/lib/credits/usage-retention"

function verifyMeteringSecret(req: NextRequest): boolean {
  const secret = req.headers.get(METERING_SECRET_HEADER)?.trim()
  const expected = process.env.METERING_MASTER_SECRET?.trim()
  return Boolean(secret && expected && secret === expected)
}

export async function POST(req: NextRequest) {
  // Auth FIRST - same order as live probes (placeholder secret → 401 before body).
  if (!verifyMeteringSecret(req)) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiError("VALIDATION_ERROR", "Body must be JSON", 400)
  }

  // Empty batch is a no-op success (proxy may flush with nothing after a race).
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { records?: unknown }).records) &&
    (raw as { records: unknown[] }).records.length === 0
  ) {
    const dropped = (raw as { droppedCount?: number }).droppedCount
    if (typeof dropped === "number" && dropped > 0) {
      log.warn("Proxy dropped usage records", { droppedCount: dropped })
    }
    return apiSuccess({ processed: 0 })
  }

  const parsed = proxyReportBatchBodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      `Invalid proxy report-batch body: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    )
  }

  const { records, droppedCount } = parsed.data

  if (droppedCount > 0) {
    log.warn("Proxy dropped usage records", { droppedCount })
  }

  const workspaceIds = [...new Set(records.map((r) => r.workspaceId))]
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: workspaceIds } },
    select: { id: true, userId: true },
  })
  const wsUserMap = new Map(workspaces.map((w) => [w.id, w.userId]))

  const byUser = new Map<string, typeof records>()
  for (const record of records) {
    const userId = wsUserMap.get(record.workspaceId)
    if (!userId) continue
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId)!.push(record)
  }

  let totalProcessed = 0
  let totalHandled = 0
  // Collect exhaustion side-effects outside the transaction; schedule via
  // after() so Vercel does not kill setImmediate/bare-promise work when the
  // response ends (same class as the dashboard wake fire-and-forget bug).
  const exhaustedUserIds: string[] = []

  for (const [userId, userRecords] of byUser) {
    try {
      let exhausted = false
      let newBalance = 0
      let wrote = false
      let persisted = 0
      let spendCents = 0
      let handled = 0

      await prisma.$transaction(async (tx) => {
        const account = await tx.creditAccount.findUnique({ where: { userId } })
        if (!account || account.status !== "ACTIVE") return

        // Soft idempotency: drop retries whose fingerprint matches a recent row.
        const fresh: ProxyUsageRecord[] = []
        for (const r of userRecords) {
          const idempotencyKey = usageRecordIdempotencyKey(r)
          const ts = Date.parse(r.timestamp)
          const windowStart = Number.isFinite(ts)
            ? new Date(ts - 120_000)
            : new Date(Date.now() - 120_000)
          const windowEnd = Number.isFinite(ts)
            ? new Date(ts + 120_000)
            : new Date()
          const dup = await tx.creditUsageRecord.findFirst({
            where: {
              creditAccountId: account.id,
              workspaceId: r.workspaceId,
              model: r.model,
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens,
              costCents: r.costCents,
              createdAt: { gte: windowStart, lte: windowEnd },
            },
            select: { id: true },
          })
          if (dup) {
            log.info("report-batch: skip duplicate via idempotencyKey", {
              userId,
              idempotencyKey,
            })
            handled += 1
            continue
          }
          fresh.push(r)
        }

        if (fresh.length === 0) {
          wrote = true
          persisted = 0
          spendCents = 0
          newBalance = account.balanceCents
          return
        }

        spendCents = fresh.reduce((sum, r) => sum + (r.costCents || 0), 0)
        newBalance = Math.max(0, account.balanceCents - spendCents)

        await tx.creditAccount.update({
          where: { userId },
          data: {
            balanceCents: newBalance,
            totalConsumedCents: { increment: spendCents },
            status: newBalance === 0 ? "EXHAUSTED" : "ACTIVE",
            exhaustedAt: newBalance === 0 ? new Date() : undefined,
          },
        })

        // MUTATION: drop createMany → usage-retention + handshake tests fail.
        await tx.creditUsageRecord.createMany({
          data: fresh.map((r) => ({
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

        // One-shot ledger note when account shows prior consumption but we are
        // minting the first retained row after the 7d-purge era (no backfill).
        if (account.totalConsumedCents > 0) {
          const priorNote = await tx.activityLog.findFirst({
            where: {
              workspaceId: { in: fresh.map((r) => r.workspaceId) },
              actionType: "SYSTEM",
              metadata: { contains: PRE_INSTRUMENTATION_NOTE_EVENT_KIND },
            },
            select: { id: true },
          })
          if (!priorNote) {
            const wsId = fresh[0]!.workspaceId
            await tx.activityLog.create({
              data: {
                workspaceId: wsId,
                actionType: "SYSTEM",
                action: "Credit ledger note: pre-instrumentation consumption",
                detail: `Account totalConsumedCents=${account.totalConsumedCents} predates retained CreditUsageRecord rows (7d purge / pre-retention). Not backfilled.`,
                metadata: JSON.stringify({
                  eventKind: PRE_INSTRUMENTATION_NOTE_EVENT_KIND,
                  totalConsumedCents: account.totalConsumedCents,
                  note: "pre-instrumentation consumption",
                }),
              },
            })
          }
        }

        exhausted = newBalance === 0
        wrote = true
        persisted = fresh.length
        handled += fresh.length
      })

      if (!wrote) continue

      totalProcessed += persisted
      totalHandled += handled

      // Redis is a cache of the DB ledger - never fail the durable write if
      // Upstash is down (that was a silent 200/processed:0 → proxy drop path).
      try {
        await redis.set(`credit:balance:${userId}`, newBalance.toString())
        if (spendCents > 0) {
          await redis.decrby(`credit:reservations:${userId}`, spendCents)
        }
      } catch (redisErr) {
        log.warn("report-batch: redis cache update failed after durable write", {
          userId,
          error: String(redisErr),
        })
      }

      if (exhausted) exhaustedUserIds.push(userId)
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

  // Proxy only requeues on !res.ok. A 200 with processed:0 after a non-empty
  // batch would DROP the in-memory pending forever - return 503 so it retries.
  // All-duplicate batches are handled (idempotent success) - do not 503.
  if (records.length > 0 && totalHandled === 0 && totalProcessed === 0) {
    return apiError(
      "PROCESSING_FAILED",
      "No usage records were persisted; proxy should requeue",
      503,
    )
  }

  return apiSuccess({ processed: totalProcessed })
}
