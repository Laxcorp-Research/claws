/**
 * Atomic credit-window reservation against Redis.
 *
 * Prefer Lua EVAL (single round-trip, race-safe). Some Upstash plan/API
 * combinations reject EVAL while GET/SET/INCRBY still work — that was the
 * staging reserve-window HTTP 500 (uncaught eval throw). Fallback is a
 * best-effort GET+INCRBY path so metering stays fail-closed on balance,
 * not crash-open via proxy degrade.
 */
import { redis } from "@/lib/redis"
import { log } from "@/lib/logger"

const RESERVE_LUA = `
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

export type ReserveAtomicResult =
  | { ok: true; remainingCents: number; via: "eval" | "fallback" }
  | { ok: false; reason: "INSUFFICIENT_CREDITS"; via: "eval" | "fallback" }

async function reserveViaFallback(
  balanceKey: string,
  reservationsKey: string,
  cost: number,
): Promise<ReserveAtomicResult> {
  const balanceRaw = await redis.get(balanceKey)
  const reservationsRaw = await redis.get(reservationsKey)
  const balance = parseInt(String(balanceRaw ?? "0"), 10) || 0
  const reservations = parseInt(String(reservationsRaw ?? "0"), 10) || 0
  const available = balance - reservations
  if (available < cost) {
    return { ok: false, reason: "INSUFFICIENT_CREDITS", via: "fallback" }
  }
  await redis.incrby(reservationsKey, cost)
  await redis.expire(reservationsKey, 600)
  return { ok: true, remainingCents: available - cost, via: "fallback" }
}

export async function reserveWindowAtomic(args: {
  balanceKey: string
  reservationsKey: string
  windowSizeCents: number
}): Promise<ReserveAtomicResult> {
  const { balanceKey, reservationsKey, windowSizeCents } = args
  try {
    const remaining = (await redis.eval(
      RESERVE_LUA,
      [balanceKey, reservationsKey],
      [windowSizeCents.toString()],
    )) as number
    if (typeof remaining !== "number" || Number.isNaN(remaining)) {
      throw new Error(`reserve eval returned non-number: ${String(remaining)}`)
    }
    if (remaining < 0) {
      return { ok: false, reason: "INSUFFICIENT_CREDITS", via: "eval" }
    }
    return { ok: true, remainingCents: remaining, via: "eval" }
  } catch (err) {
    log.warn("reserve-window EVAL failed; using GET+INCRBY fallback", {
      error: err instanceof Error ? err.message : String(err),
      balanceKey,
    })
    return reserveViaFallback(balanceKey, reservationsKey, windowSizeCents)
  }
}
