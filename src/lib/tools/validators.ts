/**
 * Tool API key validators.
 *
 * Before this module, `POST /api/tools/[workspaceId]` accepted any string as
 * a valid API key: the row was stored and marked CONNECTED regardless of
 * whether the key worked. Users deployed workspaces with invalid keys and
 * their agents failed in production with auth errors the user couldn't
 * attribute to a wrong key entered weeks earlier.
 *
 * Each validator hits a lightweight authenticated endpoint on the provider
 * and returns one of:
 *   - { valid: true }                                verified working
 *   - { valid: false, error }                        explicitly invalid
 *   - { valid: true, warning }                       provider 5xx; key saved
 *                                                    but not verified
 *   - { valid: true, unverified: true, message }     no validator exists
 *                                                    for this tool yet
 *
 * Rate-limit responses (429) are treated as valid — the key works, the
 * account is just throttled right now.
 *
 * IMPLEMENTED (7 of 26 API_KEY tools):
 *   anthropic_api, tavily, stripe_api, sendgrid, elevenlabs, brave_search,
 *   youtube-data-api
 *
 * DEFERRED (19) — why each is hard to validate from a single apiKey field:
 *   alpaca                 requires key_id + secret_key pair in separate headers
 *   binance                requires HMAC-SHA256 request signing with key + secret
 *   twilio                 Basic auth with Account SID + Auth Token pair
 *   mixpanel               service account username + secret pair
 *   twitter-api            OAuth 1.0a (4 values) or OAuth 2.0 Bearer — unclear
 *                          which one a single-field input represents
 *   google-search-console  OAuth-only; catalog is mislabeled as API_KEY
 *   mailgun        domain-scoped sending keys and a new token scheme; no
 *                  universal /me endpoint that works for both
 *   clay           HMAC-signed webhooks; no documented key-validation
 *                  endpoint exposed publicly
 *   polymarket     Privy-issued tokens, not plain API keys
 *   vidiq          no public API with documented validation endpoint
 *   ahrefs         token scheme varies by plan (v3 vs legacy)
 *   semrush        no documented validation endpoint that doesn't consume
 *                  paid credits
 *   instantly      v1 vs v2 schemes differ and the catalog placeholder
 *                  doesn't pin one
 *   posthog        personal vs project keys have different auth endpoints
 *   apollo         endpoint shape unconfirmed; skipping pending docs check
 *   serp_api       endpoint shape unconfirmed
 *   exa_search     endpoint shape unconfirmed
 *   cal_com        endpoint shape unconfirmed
 *   stabilityai    endpoint shape unconfirmed
 *
 * Unvalidated tools are saved with `status: PENDING` and a `lastError`
 * explaining that the key was stored but not verified. They aren't
 * marked CONNECTED (green) until something downstream confirms them.
 */

import { log } from "@/lib/logger"

export interface ValidationResult {
  /** True means "safe to save this key". False means "reject the save". */
  valid: boolean
  /** Human-readable reason when `valid: false`. */
  error?: string
  /** Set when the provider was unreachable; key is saved but not verified. */
  warning?: string
  /** True when no validator is registered for this tool slug. */
  unverified?: boolean
  /** Informational message accompanying `unverified` or `warning`. */
  message?: string
  /** Optional metadata returned by the provider. */
  meta?: Record<string, unknown>
}

export type ToolValidator = (apiKey: string) => Promise<ValidationResult>

const TIMEOUT_MS = 10_000

const TRANSIENT_WARNING =
  "Couldn't verify right now — the provider returned a server error. Your key is saved but hasn't been tested."

const UNVERIFIED_MESSAGE =
  "Connected but not verified — will be tested on first use."

/** Common post-fetch status mapping. */
function classifyByStatus(
  status: number,
  providerLabel: string,
): ValidationResult | null {
  if (status === 401 || status === 403) {
    return { valid: false, error: `Invalid ${providerLabel} API key` }
  }
  if (status === 429) {
    return { valid: true }
  }
  if (status >= 500 && status <= 599) {
    return { valid: true, warning: TRANSIENT_WARNING }
  }
  return null
}

// ─── Individual validators ─────────────────────────────

async function validateAnthropic(apiKey: string): Promise<ValidationResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const byStatus = classifyByStatus(res.status, "Anthropic")
  if (byStatus) return byStatus

  if (res.status === 400) {
    // Invalid *request* (e.g., unavailable model) still means the key was
    // accepted. Valid.
    const body = await res.json().catch(() => null)
    if (body?.error?.type === "invalid_request_error") return { valid: true }
    return { valid: false, error: "Anthropic rejected the request" }
  }
  if (res.ok) return { valid: true }
  return { valid: false, error: `Anthropic returned ${res.status}` }
}

async function validateTavily(apiKey: string): Promise<ValidationResult> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: "test",
      max_results: 1,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "Tavily")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Tavily returned ${res.status}` }
}

async function validateStripe(apiKey: string): Promise<ValidationResult> {
  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "Stripe")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Stripe returned ${res.status}` }
}

async function validateSendGrid(apiKey: string): Promise<ValidationResult> {
  const res = await fetch("https://api.sendgrid.com/v3/user/profile", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "SendGrid")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `SendGrid returned ${res.status}` }
}

async function validateElevenLabs(apiKey: string): Promise<ValidationResult> {
  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "ElevenLabs")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `ElevenLabs returned ${res.status}` }
}

async function validateBraveSearch(apiKey: string): Promise<ValidationResult> {
  const res = await fetch(
    "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  const byStatus = classifyByStatus(res.status, "Brave Search")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  // Brave returns 422 for a missing/bad subscription token on some plans.
  if (res.status === 422) {
    return { valid: false, error: "Invalid Brave Search API key" }
  }
  return { valid: false, error: `Brave Search returned ${res.status}` }
}

async function validateYouTubeData(apiKey: string): Promise<ValidationResult> {
  // i18nLanguages is a metadata endpoint with negligible quota impact.
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (res.ok) return { valid: true }
  if (res.status >= 500 && res.status <= 599) {
    return { valid: true, warning: TRANSIENT_WARNING }
  }
  // YouTube returns 400 with a `keyInvalid` reason for bad keys and 403 for
  // keys that exist but can't access the API.
  const body = await res.json().catch(() => null)
  const reason = body?.error?.errors?.[0]?.reason as string | undefined
  if (reason === "keyInvalid" || reason === "badRequest") {
    return { valid: false, error: "Invalid YouTube Data API key" }
  }
  if (res.status === 403) {
    return {
      valid: false,
      error:
        reason === "accessNotConfigured"
          ? "YouTube Data API is not enabled for this key's project"
          : "YouTube Data API key lacks permission",
    }
  }
  return { valid: false, error: `YouTube returned ${res.status}` }
}

// ─── Registry + dispatch ───────────────────────────────

const VALIDATORS: Record<string, ToolValidator> = {
  anthropic_api: validateAnthropic,
  tavily: validateTavily,
  stripe_api: validateStripe,
  sendgrid: validateSendGrid,
  elevenlabs: validateElevenLabs,
  brave_search: validateBraveSearch,
  "youtube-data-api": validateYouTubeData,
}

/** Exposed for tests to assert coverage. */
export const IMPLEMENTED_SLUGS: readonly string[] = Object.freeze(
  Object.keys(VALIDATORS),
)

export function hasValidator(toolSlug: string): boolean {
  return toolSlug in VALIDATORS
}

export async function validateToolKey(
  toolSlug: string,
  apiKey: string,
): Promise<ValidationResult> {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: "API key is empty" }
  }

  const validator = VALIDATORS[toolSlug]

  if (!validator) {
    log.warn("No validator for tool; accepting without verification", {
      category: "tool_validation",
      toolSlug,
    })
    return {
      valid: true,
      unverified: true,
      message: UNVERIFIED_MESSAGE,
    }
  }

  try {
    return await validator(apiKey)
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    log.error("Tool validation network error", {
      category: "tool_validation",
      toolSlug,
      error: err instanceof Error ? err.message : String(err),
      timedOut: isAbort,
    })
    return {
      valid: false,
      error: isAbort
        ? "Provider didn't respond within 10 seconds"
        : "Unable to validate key. Check your connection and try again.",
    }
  }
}
