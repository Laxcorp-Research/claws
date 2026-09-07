/** Auth profiles, structured errors, and size cap for the claws-http tool. */

export const FORBIDDEN_CALLER_HEADER_NAMES = [
  "authorization",
  "apca-api-key-id",
  "apca-api-secret-key",
  "x-api-key",
]

export const MAX_RESPONSE_BYTES = 256 * 1024
export const MAX_429_RETRIES = 2
export const MAX_RETRY_AFTER_MS = 5_000

export const AUTH_PROFILES = {
  "tavily-search": { profile: "tavily-body-key", env: "TAVILY_API_KEY" },
  "twitter-api": { profile: "bearer", env: "TWITTER_API_KEY" },
  "alpaca-trading": {
    profile: "alpaca-dual-header",
    keyEnv: "ALPACA_API_KEY_ID",
    secretEnv: "ALPACA_API_SECRET_KEY",
  },
}

export const COMPOSIO_PROFILE = {
  profile: "composio",
  keyEnv: "COMPOSIO_API_KEY",
  userEnv: "COMPOSIO_USER_ID",
  accountEnv: "COMPOSIO_CONNECTED_ACCOUNT_ID",
}

export function callerSuppliedForbiddenHeaders(headers) {
  if (!headers || typeof headers !== "object") return []
  const hits = []
  for (const raw of Object.keys(headers)) {
    const name = String(raw).trim().toLowerCase()
    if (FORBIDDEN_CALLER_HEADER_NAMES.includes(name)) hits.push(name)
  }
  return hits
}

export function resolveAuthProfile(skill) {
  if (AUTH_PROFILES[skill]) return AUTH_PROFILES[skill]
  if (typeof skill === "string" && skill.startsWith("composio-")) return COMPOSIO_PROFILE
  return null
}

export function applyAuthProfile(args) {
  const profile = args.profile
  const env = args.env ?? {}
  const headers = { ...(args.headers ?? {}) }
  let body = args.body

  if (!profile) {
    return { ok: false, code: "AUTH", message: "no auth profile for skill" }
  }

  if (profile.profile === "bearer") {
    const token = env[profile.env]
    if (!token) return { ok: false, code: "AUTH", message: `${profile.env} is not set` }
    headers.Authorization = `Bearer ${token}`
    return { ok: true, headers, body }
  }

  if (profile.profile === "alpaca-dual-header") {
    const key = env[profile.keyEnv]
    const secret = env[profile.secretEnv]
    if (!key || !secret) {
      return { ok: false, code: "AUTH", message: "ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set" }
    }
    headers["APCA-API-KEY-ID"] = key
    headers["APCA-API-SECRET-KEY"] = secret
    return { ok: true, headers, body }
  }

  if (profile.profile === "tavily-body-key") {
    const key = env[profile.env]
    if (!key) return { ok: false, code: "AUTH", message: "TAVILY_API_KEY is not set" }
    if (body && typeof body === "object" && !Array.isArray(body)) {
      body = { ...body, api_key: key }
    } else {
      body = { api_key: key }
    }
    return { ok: true, headers, body }
  }

  if (profile.profile === "composio") {
    const key = env[profile.keyEnv]
    if (!key) return { ok: false, code: "AUTH", message: "COMPOSIO_API_KEY is not set" }
    headers["X-API-Key"] = key
    const existing = body && typeof body === "object" && !Array.isArray(body) ? body : {}
    body = {
      ...existing,
      user_id: existing.user_id ?? env[profile.userEnv],
      connected_account_id: existing.connected_account_id ?? env[profile.accountEnv],
    }
    return { ok: true, headers, body }
  }

  return { ok: false, code: "AUTH", message: `unknown auth profile ${profile.profile}` }
}

export function classifyHttpStatus(status) {
  if (status === 401) return "AUTH"
  if (status === 402) return "PAYMENT"
  if (status === 403) return "SCOPE"
  if (status === 429) return "RATE"
  if (status >= 500) return "UPSTREAM"
  return null
}

export function parseRetryAfterMs(value) {
  if (value == null) return 1_000
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(asNumber * 1000, MAX_RETRY_AFTER_MS)
  }
  const when = Date.parse(String(value))
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(0, when - Date.now()), MAX_RETRY_AFTER_MS)
  }
  return 1_000
}

export function capResponseBytes(text, max = MAX_RESPONSE_BYTES) {
  const encoded = Buffer.from(String(text ?? ""), "utf8")
  if (encoded.length <= max) {
    return { text: encoded.toString("utf8"), bytes: encoded.length, truncated: false }
  }
  return {
    text: encoded.subarray(0, max).toString("utf8"),
    bytes: encoded.length,
    truncated: true,
  }
}

export function httpActionUrl(activityEndpoint, workspaceId) {
  const base = String(activityEndpoint ?? "").replace(/\/activity\/?$/, "")
  return `${base}/http-action/${workspaceId}`
}

export function structuredError(code, extra = {}) {
  return {
    error: {
      code,
      ...extra,
    },
  }
}
