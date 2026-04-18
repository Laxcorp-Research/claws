/**
 * Tool credential validators.
 *
 * Each validator receives a credentials record keyed by env-var name
 * (matches credentialFields in src/data/tool-catalog.ts) and hits a
 * lightweight authenticated endpoint on the provider. Return shapes:
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
 * IMPLEMENTED (12 of 29 API_KEY tools after PR #2):
 *   anthropic_api, tavily, stripe_api, sendgrid, elevenlabs, brave_search,
 *   youtube-data-api, binance, alpaca, coinbase, salesforce-api, beehiiv-api
 *
 * DEFERRED (17 — why each is hard to validate from whatever credentials we
 * persist today):
 *   twilio          Basic auth with Account SID + Auth Token pair; our
 *                   catalog only stores the token, not the SID
 *   mixpanel        service-account username + secret pair; our catalog
 *                   only stores the secret
 *   twitter-api     OAuth 1.0a (4 values) or OAuth 2.0 Bearer — unclear
 *                   which one a single-field input represents
 *   google-search-console  OAuth-only; catalog is mislabeled as API_KEY
 *   mailgun         domain-scoped sending keys and a new token scheme; no
 *                   universal /me endpoint that works for both
 *   clay            HMAC-signed webhooks; no documented key-validation
 *                   endpoint exposed publicly
 *   polymarket      Privy-issued tokens, not plain API keys
 *   vidiq           no public API with documented validation endpoint
 *   ahrefs          token scheme varies by plan (v3 vs legacy)
 *   semrush         no documented validation endpoint that doesn't consume
 *                   paid credits
 *   instantly       v1 vs v2 schemes differ and the catalog placeholder
 *                   doesn't pin one
 *   posthog         personal vs project keys have different auth endpoints
 *   apollo          endpoint shape unconfirmed; skipping pending docs check
 *   serp_api        endpoint shape unconfirmed
 *   exa_search      endpoint shape unconfirmed
 *   cal_com         endpoint shape unconfirmed
 *   stabilityai     endpoint shape unconfirmed
 *
 * Unvalidated tools are saved with `status: PENDING` and a `lastError`
 * explaining that the key was stored but not verified. They aren't
 * marked CONNECTED (green) until something downstream confirms them.
 */

import crypto from "node:crypto"
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

/**
 * Signature post-PR #2: validators receive the full credentials record
 * keyed by env-var name. Each validator reads its own expected keys;
 * extras are ignored (the API route rejects extra keys at submit time).
 */
export type ToolValidator = (
  credentials: Record<string, string>,
) => Promise<ValidationResult>

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

/**
 * Asserts that all `requiredVars` are non-empty strings in `credentials`.
 * Returns a ValidationResult on failure; returns null on success so callers
 * can short-circuit like: `const miss = requireFields(...); if (miss) return miss;`
 */
function requireFields(
  credentials: Record<string, string>,
  requiredVars: string[],
  providerLabel: string,
): ValidationResult | null {
  const missing = requiredVars.filter((v) => !credentials[v]?.trim())
  if (missing.length === 0) return null
  return {
    valid: false,
    error: `Missing required ${providerLabel} credential${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
  }
}

// ─── Individual validators ─────────────────────────────

async function validateAnthropic(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["ANTHROPIC_API_KEY"], "Anthropic")
  if (miss) return miss
  const apiKey = credentials.ANTHROPIC_API_KEY

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
    const body = await res.json().catch(() => null)
    if (body?.error?.type === "invalid_request_error") return { valid: true }
    return { valid: false, error: "Anthropic rejected the request" }
  }
  if (res.ok) return { valid: true }
  return { valid: false, error: `Anthropic returned ${res.status}` }
}

async function validateTavily(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["TAVILY_API_KEY"], "Tavily")
  if (miss) return miss
  const apiKey = credentials.TAVILY_API_KEY

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query: "test", max_results: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "Tavily")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Tavily returned ${res.status}` }
}

async function validateStripe(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["STRIPE_API_KEY"], "Stripe")
  if (miss) return miss
  const apiKey = credentials.STRIPE_API_KEY

  const res = await fetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "Stripe")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Stripe returned ${res.status}` }
}

async function validateSendGrid(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["SENDGRID_API_KEY"], "SendGrid")
  if (miss) return miss
  const apiKey = credentials.SENDGRID_API_KEY

  const res = await fetch("https://api.sendgrid.com/v3/user/profile", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "SendGrid")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `SendGrid returned ${res.status}` }
}

async function validateElevenLabs(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["ELEVENLABS_API_KEY"], "ElevenLabs")
  if (miss) return miss
  const apiKey = credentials.ELEVENLABS_API_KEY

  const res = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const byStatus = classifyByStatus(res.status, "ElevenLabs")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `ElevenLabs returned ${res.status}` }
}

async function validateBraveSearch(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["BRAVE_SEARCH_API_KEY"], "Brave Search")
  if (miss) return miss
  const apiKey = credentials.BRAVE_SEARCH_API_KEY

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
  if (res.status === 422) {
    return { valid: false, error: "Invalid Brave Search API key" }
  }
  return { valid: false, error: `Brave Search returned ${res.status}` }
}

async function validateYouTubeData(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(credentials, ["YOUTUBE_DATA_API_KEY"], "YouTube Data API")
  if (miss) return miss
  const apiKey = credentials.YOUTUBE_DATA_API_KEY

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (res.ok) return { valid: true }
  if (res.status >= 500 && res.status <= 599) {
    return { valid: true, warning: TRANSIENT_WARNING }
  }
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

// ─── Multi-credential validators (new in PR #2) ─────────

/**
 * Binance: signed GET to /api/v3/account using HMAC-SHA256(queryString, secret).
 * Invalid signature → 401. Missing/invalid API key → 401 with "Invalid API-key".
 */
async function validateBinance(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(
    credentials,
    ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
    "Binance",
  )
  if (miss) return miss
  const apiKey = credentials.BINANCE_API_KEY
  const apiSecret = credentials.BINANCE_API_SECRET

  const timestamp = Date.now()
  const recvWindow = 5_000
  const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`
  const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex")

  const res = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    {
      headers: { "X-MBX-APIKEY": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )

  const byStatus = classifyByStatus(res.status, "Binance")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  // Binance returns 400 for some key/permission issues; surface the message.
  if (res.status === 400) {
    const body = await res.json().catch(() => null)
    return { valid: false, error: body?.msg ?? "Binance rejected the request" }
  }
  return { valid: false, error: `Binance returned ${res.status}` }
}

/**
 * Alpaca: two-header authentication (APCA-API-KEY-ID + APCA-API-SECRET-KEY)
 * against /v2/account on the live endpoint. Paper trading endpoint differs
 * but accepts the same auth format; we probe live first.
 */
async function validateAlpaca(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(
    credentials,
    ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"],
    "Alpaca",
  )
  if (miss) return miss

  const res = await fetch("https://api.alpaca.markets/v2/account", {
    headers: {
      "APCA-API-KEY-ID": credentials.ALPACA_API_KEY_ID,
      "APCA-API-SECRET-KEY": credentials.ALPACA_API_SECRET_KEY,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const byStatus = classifyByStatus(res.status, "Alpaca")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Alpaca returned ${res.status}` }
}

/**
 * Coinbase Exchange (formerly Pro): HMAC-SHA256(timestamp + method + path
 * + body, base64Decode(secret)), plus passphrase header.
 * Reference: https://docs.cloud.coinbase.com/exchange/docs/rest-auth
 */
async function validateCoinbase(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(
    credentials,
    ["COINBASE_API_KEY", "COINBASE_API_SECRET", "COINBASE_API_PASSPHRASE"],
    "Coinbase",
  )
  if (miss) return miss

  const timestampSec = Math.floor(Date.now() / 1000).toString()
  const method = "GET"
  const requestPath = "/accounts"
  const body = ""
  const prehash = timestampSec + method + requestPath + body

  let secretBuffer: Buffer
  try {
    secretBuffer = Buffer.from(credentials.COINBASE_API_SECRET, "base64")
  } catch {
    return { valid: false, error: "Coinbase API secret is not valid base64" }
  }

  const signature = crypto
    .createHmac("sha256", secretBuffer)
    .update(prehash)
    .digest("base64")

  const res = await fetch(`https://api.exchange.coinbase.com${requestPath}`, {
    headers: {
      "CB-ACCESS-KEY": credentials.COINBASE_API_KEY,
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestampSec,
      "CB-ACCESS-PASSPHRASE": credentials.COINBASE_API_PASSPHRASE,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const byStatus = classifyByStatus(res.status, "Coinbase")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Coinbase returned ${res.status}` }
}

/** Basic `https://{something}.my.salesforce.com` or `.salesforce.com` URL. */
const SALESFORCE_INSTANCE_URL_REGEX =
  /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9-]*(\.my)?\.salesforce\.com\/?$/

async function validateSalesforceApi(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(
    credentials,
    ["SALESFORCE_INSTANCE_URL", "SALESFORCE_ACCESS_TOKEN"],
    "Salesforce",
  )
  if (miss) return miss

  const instanceUrl = credentials.SALESFORCE_INSTANCE_URL.trim().replace(/\/+$/, "")
  if (!SALESFORCE_INSTANCE_URL_REGEX.test(instanceUrl)) {
    return {
      valid: false,
      error:
        "Instance URL must look like https://<org>.my.salesforce.com or https://<org>.salesforce.com",
    }
  }

  const res = await fetch(`${instanceUrl}/services/data/v59.0/`, {
    headers: { Authorization: `Bearer ${credentials.SALESFORCE_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const byStatus = classifyByStatus(res.status, "Salesforce")
  if (byStatus) return byStatus
  if (res.ok) return { valid: true }
  return { valid: false, error: `Salesforce returned ${res.status}` }
}

/** Beehiiv pub IDs look like `pub_<uuid>`. We don't require that format. */
async function validateBeehiivApi(
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const miss = requireFields(
    credentials,
    ["BEEHIIV_PUBLICATION_ID", "BEEHIIV_API_KEY"],
    "Beehiiv",
  )
  if (miss) return miss

  const pubId = encodeURIComponent(credentials.BEEHIIV_PUBLICATION_ID.trim())
  const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}`, {
    headers: { Authorization: `Bearer ${credentials.BEEHIIV_API_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const byStatus = classifyByStatus(res.status, "Beehiiv")
  if (byStatus) return byStatus
  if (res.status === 404) {
    return { valid: false, error: "Beehiiv publication not found for this key" }
  }
  if (res.ok) return { valid: true }
  return { valid: false, error: `Beehiiv returned ${res.status}` }
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
  binance: validateBinance,
  alpaca: validateAlpaca,
  coinbase: validateCoinbase,
  "salesforce-api": validateSalesforceApi,
  "beehiiv-api": validateBeehiivApi,
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
  credentials: Record<string, string>,
): Promise<ValidationResult> {
  const nonEmpty = Object.values(credentials).filter((v) => v && v.trim())
  if (nonEmpty.length === 0) {
    return { valid: false, error: "Credentials record is empty" }
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
    return await validator(credentials)
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
