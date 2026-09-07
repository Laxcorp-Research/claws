/**
 * WAVE-0 fire findings:
 * - X API 402 is tier-not-entitled, not "down".
 * - Sep-1 flap: web_fetch of /2/tweets/search/recent without Authorization
 *   always 401s even when the Bearer is live. Reconnect is not the remedy.
 * Store copy and TOOLS.md must say that in the same words the mission
 * failure-branch uses, so the claw and the human see one story.
 */

export const TWITTER_API_402_COPY =
  "X API returned 402 Payment Required - add credits/upgrade at developer.x.com; running Tavily-only until then"

export const TWITTER_API_STORE_TIER_NOTE =
  "required Twitter API - free tier limits reads"

export const TWITTER_TOKEN_CANNOT_POST_COPY =
  "This token cannot post. Never say a post ships."

export const TWITTER_API_VALIDATE_URL =
  "https://api.twitter.com/2/users/by/username/X"

export const TWITTER_API_401_RECONNECT_COPY =
  "X API returned AUTH (401) from the http tool - token is dead; reconnect in Manage Tools. Stop. Do not invent trends."

export const TWITTER_API_WEBFETCH_401_COPY =
  "Do not web_fetch api.twitter.com or api.x.com. Those hosts are not public pages. Call the http tool (twitter-api). Auth is injected. A web_fetch 401 is missing Authorization, not token-dead. Reconnect is not the remedy."

export const TWITTER_API_USERS_ME_FORBIDDEN_COPY =
  "GET /2/users/me is forbidden for app-only Bearer (403 Unsupported Authentication). It is not a dead token. Do not reconnect. Use GET /2/users/by/username/X or GET /2/tweets/search/recent."

export type TwitterApiClass =
  | "live"
  | "dead-token"
  | "tier"
  | "app-only-forbidden"
  | "unauthenticated"
  | "rate-limit"
  | "transient"
  | "unknown"

export type TwitterNudgeCondition = "twitter-402-tier"

export function storeToolHonestyNote(slug: string): string | null {
  if (slug === "twitter-api") return TWITTER_API_STORE_TIER_NOTE
  return null
}

export function classifyTwitterApiFailure(input: {
  status: number
  url?: string
  body?: string
  toolName?: string
  sentAuthorization?: boolean
}): TwitterApiClass {
  const body = (input.body ?? "").toLowerCase()
  const url = (input.url ?? "").toLowerCase()
  const tool = (input.toolName ?? "").toLowerCase()

  if (input.status >= 200 && input.status < 300) return "live"

  const missingBearer =
    tool === "web_fetch" || input.sentAuthorization === false

  if (input.status === 402) return "tier"

  if (
    input.status === 403 &&
    (body.includes("unsupported authentication") ||
      body.includes("application-only is forbidden") ||
      /\/2\/users\/me(?:\?|$)/.test(url))
  ) {
    return "app-only-forbidden"
  }

  if (
    input.status === 403 &&
    /client-not-enrolled|not permitted|credits|payment required|upgrade|entitled/.test(
      body,
    )
  ) {
    return "tier"
  }

  if (input.status === 401 && missingBearer) return "unauthenticated"
  if (input.status === 401) return "dead-token"
  if (input.status === 429) return "rate-limit"
  if (input.status >= 500 && input.status <= 599) return "transient"
  return "unknown"
}

function metadataToolName(metadata: string | null | undefined): string | undefined {
  if (!metadata) return undefined
  const match = /"toolName"\s*:\s*"([^"]+)"/.exec(metadata)
  return match?.[1]
}

/**
 * Platform reconnect/tier nudge from an activity ERROR blob.
 * web_fetch 401 must not become a reconnect (Sep-1 flap).
 * Only 402 entitlement is a customer nudge today.
 */
export function twitterNudgeFromActivity(args: {
  type: string
  action: string
  detail?: string | null
  metadata?: string | null
}): TwitterNudgeCondition | null {
  if (args.type !== "ERROR") return null
  const blob = `${args.action} ${args.detail ?? ""} ${args.metadata ?? ""}`
  if (!/twitter|x api|api\.twitter\.com|api\.x\.com/i.test(blob)) {
    return null
  }
  const toolName =
    metadataToolName(args.metadata) ??
    (/web_fetch/i.test(blob) ? "web_fetch" : undefined)
  const status = /402/.test(blob) ? 402 : /403/.test(blob) ? 403 : /401/.test(blob) ? 401 : 0
  const classified = classifyTwitterApiFailure({
    status,
    body: blob,
    toolName,
    sentAuthorization: toolName === "web_fetch" ? false : undefined,
    url: blob,
  })
  if (classified === "tier") return "twitter-402-tier"
  return null
}

export function twitterApiToolsMdHonestyLines(toolSlug: string): string {
  if (toolSlug !== "twitter-api") return ""
  return `
- Never web_fetch api.twitter.com or api.x.com. ${TWITTER_API_WEBFETCH_401_COPY}
- Never GET /2/users/me. ${TWITTER_API_USERS_ME_FORBIDDEN_COPY}
- AUTH (401) from the http tool: ${TWITTER_API_401_RECONNECT_COPY}
- 402: ${TWITTER_API_402_COPY}
- 402 means the saved Bearer is real but the X API tier does not include that endpoint. It is not "down."
- PENDING or unverified last-probe is not READY. READY only after a 200 from an app-only endpoint via the http tool.
- ${TWITTER_TOKEN_CANNOT_POST_COPY}`
}
