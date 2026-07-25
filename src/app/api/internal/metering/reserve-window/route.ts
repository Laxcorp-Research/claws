import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { redis } from "@/lib/redis"
import { prisma } from "@/lib/db"
import {
  METERING_SECRET_HEADER,
  proxyReserveWindowBodySchema,
} from "@/lib/credits/proxy-metering-payload"
import { reserveWindowAtomic } from "@/lib/credits/reserve-window-atomic"
import { log } from "@/lib/logger"

function verifyMeteringSecret(req: NextRequest): boolean {
  const secret = req.headers.get(METERING_SECRET_HEADER)?.trim()
  const expected = process.env.METERING_MASTER_SECRET?.trim()
  return Boolean(secret && expected && secret === expected)
}

export async function POST(req: NextRequest) {
  if (!verifyMeteringSecret(req)) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiError("VALIDATION_ERROR", "Body must be JSON", 400)
  }

  const parsed = proxyReserveWindowBodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "userId and windowSizeCents required", 400)
  }

  const { userId, windowSizeCents } = parsed.data

  const balanceKey = `credit:balance:${userId}`
  const reservationsKey = `credit:reservations:${userId}`

  // Seed Redis from the durable ledger when the cache key is missing so
  // credit-proxy canSpend does not fail-closed (or degrade) on a cold cache.
  // Warm-but-wrong: any Redis↔DB mismatch (ε = 0¢) re-seeds from DB before Lua.
  try {
    const cached = await redis.get(balanceKey)
    if (cached === null) {
      const account = await prisma.creditAccount.findUnique({
        where: { userId },
        select: { balanceCents: true, status: true },
      })
      if (account && account.status === "ACTIVE") {
        await redis.set(balanceKey, account.balanceCents.toString())
      }
    } else {
      const account = await prisma.creditAccount.findUnique({
        where: { userId },
        select: { balanceCents: true, status: true },
      })
      if (account && account.status === "ACTIVE") {
        const cachedRaw = typeof cached === "string" ? cached : String(cached)
        const redisCents = Number.parseInt(cachedRaw, 10)
        const dbCents = account.balanceCents
        // ε = 0¢ — any mismatch (incl. non-numeric Redis) re-seeds from DB.
        if (!Number.isFinite(redisCents) || redisCents !== dbCents) {
          log.warn("reserve-window: balance divergence; re-seeding Redis from DB", {
            userId,
            dbCents,
            redisCents: Number.isFinite(redisCents) ? redisCents : cachedRaw,
          })
          await redis.set(balanceKey, dbCents.toString())
        }
      }
    }
  } catch (err) {
    log.warn("reserve-window: redis seed failed; continuing to reserve", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    const result = await reserveWindowAtomic({
      balanceKey,
      reservationsKey,
      windowSizeCents,
    })
    if (!result.ok) {
      return apiSuccess({ allowed: false, reason: result.reason })
    }
    return apiSuccess({
      allowed: true,
      remainingCents: result.remainingCents,
      via: result.via,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error("reserve-window: reserve failed", { userId, error: detail })
    // Include detail so staging ops can diagnose without Vercel log dig
    // (still a 503 — proxy treats !ok as fail and degrades/closes).
    return apiError(
      "REDIS_UNAVAILABLE",
      `Credit reservation temporarily unavailable: ${detail.slice(0, 180)}`,
      503,
    )
  }
}
