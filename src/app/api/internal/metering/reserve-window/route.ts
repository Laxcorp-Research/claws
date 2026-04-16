import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { redis } from "@/lib/redis"

function verifyMeteringSecret(req: NextRequest): boolean {
  const secret = req.headers.get("X-Metering-Secret")
  return secret === process.env.METERING_MASTER_SECRET
}

export async function POST(req: NextRequest) {
  if (!verifyMeteringSecret(req)) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  const { userId, windowSizeCents } = await req.json()

  if (!userId || !windowSizeCents) {
    return apiError("VALIDATION_ERROR", "userId and windowSizeCents required", 400)
  }

  const balanceKey = `credit:balance:${userId}`
  const reservationsKey = `credit:reservations:${userId}`

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
    [windowSizeCents.toString()]
  )) as number

  if (remaining < 0) {
    return apiSuccess({ allowed: false, reason: "INSUFFICIENT_CREDITS" })
  }

  return apiSuccess({ allowed: true, remainingCents: remaining })
}
