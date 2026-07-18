import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { redis } from "@/lib/redis"
import { prisma } from "@/lib/db"
import {
  METERING_SECRET_HEADER,
  proxyReserveWindowBodySchema,
} from "@/lib/credits/proxy-metering-payload"

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
    }
  } catch {
    // Proceed to lua; if Redis is fully down the proxy degrades open.
  }

  const luaScript = `
    local balance = tonumber(redis.call('GET', KEYS[1]) or '0')
    local reservations = tonumber(redis.call('GET', KEYS[2]) or '0')
    local cost = tonumber(ARGV[1])
    local available = balance - reservations

    if available >= cost then
      redis.call('INCRBY', KEYS[2], cost)
      redis.call('EXPIRE', KEYS[2], 600)
      return available - cost
    else
      return -1
    end
  `

  const remaining = (await redis.eval(
    luaScript,
    [balanceKey, reservationsKey],
    [windowSizeCents.toString()],
  )) as number

  if (remaining < 0) {
    // Envelope: { success, data: { allowed, reason } } — proxy reads data.data.allowed
    return apiSuccess({ allowed: false, reason: "INSUFFICIENT_CREDITS" })
  }

  return apiSuccess({ allowed: true, remainingCents: remaining })
}
