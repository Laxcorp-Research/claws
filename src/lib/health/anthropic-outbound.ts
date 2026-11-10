import { describeReachability } from "@/lib/net/reachability"

export type AnthropicOutbound = "ok" | "tls_intercepted" | "unreachable"

const CACHE_MS = 30_000
let cached: { at: number; value: AnthropicOutbound } | null = null

export function resetAnthropicOutboundCache(): void {
  cached = null
}

async function probeOnce(): Promise<AnthropicOutbound> {
  try {
    const res = await fetch("https://api.anthropic.com", {
      method: "HEAD",
      signal: AbortSignal.timeout(2500),
    })
    void res
    return "ok"
  } catch (err) {
    const kind = describeReachability(err)
    if (kind === "tls_intercepted") return "tls_intercepted"
    return "unreachable"
  }
}

/** HEAD api.anthropic.com. Any HTTP status means TLS worked. Cached so healthchecks stay fast. */
export async function probeAnthropicOutbound(now = Date.now()): Promise<AnthropicOutbound> {
  if (cached && now - cached.at < CACHE_MS) return cached.value
  const value = await probeOnce()
  cached = { at: now, value }
  return value
}
