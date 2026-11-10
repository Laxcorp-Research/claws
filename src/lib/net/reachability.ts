/**
 * Map Node network failures to the copy a self-hoster can act on.
 * Walks error.cause because undici puts the code on the cause, not the TypeError.
 */

export const TLS_INTERCEPT_MESSAGE =
  "Your network intercepts HTTPS. Export your proxy/antivirus root certificate as PEM into ./certs and run docker compose restart. See SELF_HOSTING → Behind a corporate proxy."

export const NO_OUTBOUND_MESSAGE = "No outbound internet from the container"

const TLS_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"])
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
])

export type Reachability = "tls_intercepted" | "unreachable" | "unknown"

export function nodeErrorCode(err: unknown): string | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string" && code.length > 0) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

export function describeReachability(err: unknown): Reachability {
  const code = nodeErrorCode(err)
  if (code && TLS_CODES.has(code)) return "tls_intercepted"
  if (code && UNREACHABLE_CODES.has(code)) return "unreachable"
  return "unknown"
}

export function reachabilityMessage(err: unknown, fallback: string): string {
  const kind = describeReachability(err)
  if (kind === "tls_intercepted") return TLS_INTERCEPT_MESSAGE
  if (kind === "unreachable") return NO_OUTBOUND_MESSAGE
  return fallback
}
