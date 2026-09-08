import { classifyComposioOp } from "@/lib/openclaw/composio-op-class"

export const HTTP_CLASSES = ["READ", "ACTION"] as const
export const COMPOSIO_EXECUTE_HOST = "backend.composio.dev"
export const COMPOSIO_EXECUTE_PATH_PREFIX = "/api/v3/tools/execute/"
export type HttpClass = (typeof HTTP_CLASSES)[number]

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const HTTP_AUTH_PROFILES = [
  "bearer",
  "alpaca-dual-header",
  "tavily-body-key",
  "composio",
  "x-api-key",
  "query-key",
  "binance-key",
  "twilio-basic",
  "shopify-admin",
] as const
export type HttpAuthProfile = (typeof HTTP_AUTH_PROFILES)[number]

/** Caller-supplied names the tool must reject (auth is injected by profile). */
export const FORBIDDEN_CALLER_HEADER_NAMES = [
  "authorization",
  "apca-api-key-id",
  "apca-api-secret-key",
  "x-api-key",
  "x-mbx-apikey",
  "x-shopify-access-token",
] as const

export interface HttpEndpoint {
  method: HttpMethod
  host: string
  path: string
  class: HttpClass
  operation?: string
}

export interface HttpSkillContract {
  skill: string
  auth: HttpAuthProfile
  endpoints: HttpEndpoint[]
  /** Composio toolkit prefix (GMAIL_). Unlisted ops under this prefix classify fail-closed. */
  composioOpPrefix?: string
}

export function isHttpClass(value: unknown): value is HttpClass {
  return value === "READ" || value === "ACTION"
}

export function isHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === "string" && (HTTP_METHODS as readonly string[]).includes(value)
}

export function isHttpAuthProfile(value: unknown): value is HttpAuthProfile {
  return typeof value === "string" && (HTTP_AUTH_PROFILES as readonly string[]).includes(value)
}

export function normalizeHttpHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "")
}

export function normalizeHttpPath(path: string): string {
  const trimmed = path.trim()
  const noQuery = trimmed.split("?")[0] ?? trimmed
  if (noQuery.length === 0) return "/"
  return noQuery.startsWith("/") ? noQuery : `/${noQuery}`
}

export function parseHttpTarget(args: {
  url?: string
  host?: string
  path?: string
}): { host: string; path: string } | null {
  if (typeof args.host === "string" && args.host.trim() && typeof args.path === "string") {
    return { host: normalizeHttpHost(args.host), path: normalizeHttpPath(args.path) }
  }
  if (typeof args.url === "string" && args.url.trim()) {
    try {
      const parsed = new URL(args.url)
      return { host: normalizeHttpHost(parsed.hostname), path: normalizeHttpPath(parsed.pathname) }
    } catch {
      return null
    }
  }
  return null
}

export function callerSuppliedForbiddenHeaders(
  headers: Record<string, string> | undefined,
): string[] {
  if (!headers) return []
  const hits: string[] = []
  for (const raw of Object.keys(headers)) {
    const name = raw.trim().toLowerCase()
    if ((FORBIDDEN_CALLER_HEADER_NAMES as readonly string[]).includes(name)) {
      hits.push(name)
    }
  }
  return hits
}

export function httpHostMatches(declared: string, actual: string): boolean {
  const expected = normalizeHttpHost(declared)
  const host = normalizeHttpHost(actual)
  if (expected === host) return true
  if (!expected.startsWith("*.")) return false
  const suffix = expected.slice(1)
  if (!host.endsWith(suffix) || host.length <= suffix.length) return false
  const label = host.slice(0, -suffix.length)
  return label.length > 0 && !label.includes(".")
}

export function parseComposioExecuteOp(args: {
  method: string
  host: string
  path: string
}): string | null {
  if (args.method.trim().toUpperCase() !== "POST") return null
  if (normalizeHttpHost(args.host) !== COMPOSIO_EXECUTE_HOST) return null
  const path = normalizeHttpPath(args.path)
  if (path === "/api/v3/tools/execute") return null
  if (!path.startsWith(COMPOSIO_EXECUTE_PATH_PREFIX)) return null
  const op = path.slice(COMPOSIO_EXECUTE_PATH_PREFIX.length)
  if (!op || op.includes("/") || !/^[A-Z][A-Z0-9_]*$/.test(op)) return null
  return op
}

export function matchHttpEndpoint(
  contract: HttpSkillContract,
  args: { method: string; host: string; path: string },
  opts?: { composioOverrides?: Readonly<Record<string, HttpClass>> },
): HttpEndpoint | null {
  const method = args.method.trim().toUpperCase()
  const host = normalizeHttpHost(args.host)
  const path = normalizeHttpPath(args.path)
  for (const endpoint of contract.endpoints) {
    if (endpoint.method !== method) continue
    if (!httpHostMatches(endpoint.host, host)) continue
    const declared = normalizeHttpPath(endpoint.path)
    if (path === declared || path.startsWith(`${declared}/`)) return endpoint
  }
  if (contract.auth !== "composio" || !contract.composioOpPrefix) return null
  const op = parseComposioExecuteOp({ method, host, path })
  if (!op || !op.startsWith(contract.composioOpPrefix)) return null
  return {
    method: "POST",
    host: COMPOSIO_EXECUTE_HOST,
    path: `${COMPOSIO_EXECUTE_PATH_PREFIX}${op}`,
    class: classifyComposioOp(op, opts?.composioOverrides),
    operation: op,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseHttpSkillContract(raw: unknown): HttpSkillContract | null {
  if (!isRecord(raw)) return null
  if (typeof raw.skill !== "string" || raw.skill.trim().length === 0) return null
  if (!isHttpAuthProfile(raw.auth)) return null
  if (!Array.isArray(raw.endpoints) || raw.endpoints.length === 0) return null
  const endpoints: HttpEndpoint[] = []
  for (const item of raw.endpoints) {
    if (!isRecord(item)) return null
    if (!isHttpMethod(item.method)) return null
    if (typeof item.host !== "string" || item.host.trim().length === 0) return null
    if (typeof item.path !== "string" || item.path.trim().length === 0) return null
    if (!isHttpClass(item.class)) return null
    endpoints.push({
      method: item.method,
      host: item.host.trim(),
      path: normalizeHttpPath(item.path),
      class: item.class,
      ...(typeof item.operation === "string" ? { operation: item.operation } : {}),
    })
  }
  const prefix =
    typeof raw.composioOpPrefix === "string" && raw.composioOpPrefix.trim().length > 0
      ? raw.composioOpPrefix.trim()
      : undefined
  return { skill: raw.skill.trim(), auth: raw.auth, endpoints, ...(prefix ? { composioOpPrefix: prefix } : {}) }
}
