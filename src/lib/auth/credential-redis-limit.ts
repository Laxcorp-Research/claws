import { Ratelimit } from "@upstash/ratelimit"
import { redis } from "@/lib/redis"

/** Same window as the in-memory gate: 5 attempts / 15 min / IP. */
export const credentialsRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "ratelimit:credentials",
  analytics: false,
})
