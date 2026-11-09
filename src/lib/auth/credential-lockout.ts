/** 5 attempts / 15 min / IP. Matches the proxy gate on the credentials callback. */
export const CREDENTIAL_ATTEMPT_LIMIT = 5
export const CREDENTIAL_WINDOW_MS = 15 * 60 * 1000

type Bucket = { count: number; resetAt: number }

const memory = new Map<string, Bucket>()

/** Upstash is absent on self-host: the compose file points Redis REST at a dead port. */
export function credentialRedisAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? ""
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? ""
  if (!url || !token || token === "unused") return false
  if (url.includes("127.0.0.1") || url.includes("localhost")) return false
  return url.startsWith("https://")
}

export function resetCredentialLockout(): void {
  memory.clear()
}

function memoryConsume(ip: string, now: number): "ok" | "locked" {
  const current = memory.get(ip)
  if (!current || now >= current.resetAt) {
    memory.set(ip, { count: 1, resetAt: now + CREDENTIAL_WINDOW_MS })
    return "ok"
  }
  if (current.count >= CREDENTIAL_ATTEMPT_LIMIT) return "locked"
  current.count += 1
  return "ok"
}

/**
 * Counts one credentials POST. The first five in the window are allowed
 * (a wrong password is then 401). The sixth is locked (429).
 */
export async function consumeCredentialAttempt(
  ip: string,
  now = Date.now(),
): Promise<"ok" | "locked"> {
  if (credentialRedisAvailable()) {
    try {
      const { credentialsRateLimit } = await import("@/lib/auth/credential-redis-limit")
      const { success } = await credentialsRateLimit.limit(ip)
      return success ? "ok" : "locked"
    } catch {
      // Redis missing at call time. The in-memory window still locks the IP.
    }
  }
  return memoryConsume(ip, now)
}

/** NextAuth maps a null credentials authorize() to HTTP 401. */
export function credentialRejectionStatus(gate: "ok" | "locked"): 401 | 429 {
  return gate === "locked" ? 429 : 401
}
