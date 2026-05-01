/**
 * Cheap-ops registry for the OAuth Test button (PR #5).
 *
 * For each OAUTH_COMPOSIO toolkit we ship, a zero-arg or minimal-arg
 * "whoami"-style `tools.execute` call that:
 *   (a) exists on Composio's SDK registry (validated against the 2026-04-19
 *       SDK snapshot at `C:\temp\composio-poc\90-oauth-tools-raw.json`
 *       and live-probed 2026-04-21 via
 *       `C:\temp\composio-poc\500-validate-cheap-ops.mjs` — 16/16 op names
 *       resolved cleanly; Gmail returned the expected provider-401 against
 *       a revoked test grant);
 *   (b) surfaces a clean 401/"token revoked" error from the provider when
 *       the OAuth grant is dead, so the route can distinguish dead-token
 *       from transient-infra-error;
 *   (c) does NOT mutate state at the provider.
 *
 * Asana is intentionally excluded (tracked in GH #41) — no zero-arg whoami
 * op exists in the SDK; all Asana list-ops require a qualifying param
 * (workspace/project/assignee) we don't have at Test-click time. Asana
 * rows render the Test button disabled with a "not yet supported" tooltip.
 *
 * This module is client-safe: pure data + pure classifier. No Composio SDK
 * imports, no network calls. The SDK-touching logic lives in the route.
 */

export interface CheapOp {
  /** Composio tool slug, e.g. "GMAIL_GET_PROFILE". */
  op: string
  /** Arguments passed to `composio.tools.execute`. Many are `{}`. */
  args: Record<string, unknown>
}

export const CHEAP_OPS: Record<string, CheapOp> = {
  gmail: { op: "GMAIL_GET_PROFILE", args: {} },
  // tool name per Composio SDK 2026-04-19 (note: DATE_TIME with underscore,
  // not DATETIME as one might guess from the verbose form)
  googlecalendar: { op: "GOOGLECALENDAR_GET_CURRENT_DATE_TIME", args: {} },
  // tool name per Composio SDK 2026-04-19 (note: "THE_AUTHENTICATED_USER",
  // not "AUTHENTICATED_USER")
  github: { op: "GITHUB_GET_THE_AUTHENTICATED_USER", args: {} },
  // tool name per Composio SDK 2026-04-19 (note: "USER_LOOKUP_ME", not
  // "GET_ME" — Twitter/X v2 API naming convention surfaced by Composio)
  twitter: { op: "TWITTER_USER_LOOKUP_ME", args: {} },
  hubspot: { op: "HUBSPOT_HUBSPOT_LIST_CONTACTS", args: { limit: 1 } },
  salesforce: { op: "SALESFORCE_LIST_CONTACTS", args: { limit: 1 } },
  linkedin: { op: "LINKEDIN_GET_MY_INFO", args: {} },
  slack: { op: "SLACK_LIST_ALL_CHANNELS", args: { limit: 1 } },
  notion: { op: "NOTION_GET_ABOUT_ME", args: {} },
  linear: { op: "LINEAR_GET_CURRENT_USER", args: {} },
  clickup: { op: "CLICKUP_GET_AUTHORIZED_USER", args: {} },
  shopify: { op: "SHOPIFY_GET_SHOP_DETAILS", args: {} },
  jira: { op: "JIRA_GET_CURRENT_USER", args: {} },
  calendly: { op: "CALENDLY_GET_CURRENT_USER", args: {} },
  kit: { op: "KIT_GET_ACCOUNT", args: {} },
  google_analytics: { op: "GOOGLE_ANALYTICS_LIST_ACCOUNTS", args: {} },
}

/**
 * Toolkits whose OAuth Test button renders disabled. See GH #41.
 *
 * PR2.8a additions (19): all newly-added OAUTH_COMPOSIO catalog entries
 * start here rather than in CHEAP_OPS. Each needs a zero-arg whoami op
 * verified against Composio's SDK before it graduates — the verification
 * procedure documented in the file header (500-validate-cheap-ops.mjs)
 * needs to run once per new toolkit. Deferred to a follow-up PR so PR2.8a
 * stays catalog-only. Users connecting these tools in the wizard see the
 * "Test not yet supported" disabled state until the follow-up lands.
 */
export const UNSUPPORTED_TOOLKITS: readonly string[] = [
  "asana",
  // PR2.8a additions
  "typefully",
  "docusign",
  "follow_up_boss",
  "freshbooks",
  "gitlab",
  "googleads",
  "googledocs",
  "googledrive",
  "harvest",
  "jotform",
  "lever",
  "metaads",
  "outlook",
  "pipedrive",
  "quickbooks",
  "toggl",
  "typeform",
  "webflow",
  "youtube",
]

/**
 * Tooltip copy for the disabled-Test state on unsupported toolkits.
 * Note: "not yet" is intentional — implies this is a gap we're closing,
 * not a permanent exclusion. Matches the asana issue's framing.
 */
export const UNSUPPORTED_TOOLKIT_TOOLTIP = "Test not yet supported for this tool"

export function isTestSupportedToolkit(toolkitSlug: string): boolean {
  if (UNSUPPORTED_TOOLKITS.includes(toolkitSlug)) return false
  return Object.prototype.hasOwnProperty.call(CHEAP_OPS, toolkitSlug)
}

/**
 * Classification of a Composio `tools.execute` probe outcome.
 *
 * `working` — successful:true response. Token is alive.
 * `provider_401` / `provider_403` — terminal "token is dead at provider".
 *   The route transitions DB to EXPIRED on these.
 * `toolkit_mismatch` — Composio rejected because the connection's toolkit
 *   doesn't match the requested op. Should not happen in production
 *   (we look up by toolkit), but observed during the 500-validate probe
 *   when we tested cross-toolkit ops. Logged but not a user-facing failure.
 * `invalid_args` — our registry's `args` shape is wrong for this op.
 *   Code bug. Surfaces to the UI as a generic error.
 * `op_not_found` / `version_broken` — same category: our registry drifted
 *   from Composio's SDK. Code bug. Surfaces as generic error.
 * `timeout` — probe didn't complete inside `PROBE_TIMEOUT_MS`. Transient
 *   or Composio degradation; do NOT mutate DB.
 * `unknown` — anything we couldn't classify. Do NOT mutate DB.
 */
export type ProbeCategory =
  | "working"
  | "provider_401"
  | "provider_403"
  | "toolkit_mismatch"
  | "invalid_args"
  | "op_not_found"
  | "version_broken"
  | "timeout"
  | "unknown"

export interface ProbeClassification {
  category: ProbeCategory
  /**
   * Short human-readable summary for logs + the "state: error" UI path.
   * Sanitized: never contains credentials, tokens, or internal identifiers.
   */
  message: string
}

/**
 * Dig a human-readable payload out of whatever the `@composio/core` SDK
 * throws. The SDK wraps provider errors with a generic message like
 * `"Error executing the tool X"` on the top-level `.message`, so we
 * accumulate all shape-variants Composio has been observed to use.
 *
 * Observed during the 500-validate probe (2026-04-21, @composio/core@0.6.8):
 * the real payload sometimes lives under `cause`, `response`, `body`, etc.
 * We try each and concatenate. The resulting string is what we feed to
 * `classifyByMessage`.
 */
export function extractErrorPayload(err: unknown): string {
  if (!err || typeof err !== "object") return String(err)
  const parts: string[] = []
  const e = err as Record<string, unknown>
  if (typeof e.message === "string") parts.push(`msg=${e.message}`)
  if (e.code != null) parts.push(`code=${String(e.code)}`)
  if (e.status != null) parts.push(`status=${String(e.status)}`)
  if (e.statusCode != null) parts.push(`statusCode=${String(e.statusCode)}`)
  for (const key of [
    "cause",
    "response",
    "body",
    "data",
    "responseBody",
    "details",
    "metadata",
    "errors",
    "originalError",
  ]) {
    if (e[key] != null) {
      try {
        parts.push(`${key}=${JSON.stringify(e[key]).slice(0, 400)}`)
      } catch {
        parts.push(`${key}=<unstringifiable>`)
      }
    }
  }
  return parts.join(" | ") || String(err)
}

/**
 * Turn a flattened error string into one of our `ProbeCategory` buckets.
 * Regex-based so it handles both thrown-SDK-errors and resolved
 * `{ successful: false, error }` payloads uniformly.
 */
export function classifyByMessage(msg: string): ProbeCategory | null {
  if (/tool\s*not\s*found|unknown\s*tool|no\s*such\s*tool/i.test(msg)) {
    return "op_not_found"
  }
  if (/version\s*not\s*specified|invalid\s*version|toolkit\s*version/i.test(msg)) {
    return "version_broken"
  }
  if (/403\b|forbidden/i.test(msg)) return "provider_403"
  if (
    /401\b|invalid\s*authentication|invalid\s*credentials|unauthorized|token.*expired|token.*revoked|invalid_grant/i.test(
      msg,
    )
  ) {
    return "provider_401"
  }
  if (
    /invalid\s*arguments|missing\s*required|validation\s*error|required\s*property|must\s*be/i.test(
      msg,
    )
  ) {
    return "invalid_args"
  }
  if (
    /connect.*account|account.*connect|toolkit\s*mismatch|no\s*connect|not\s*connected|different\s*toolkit|account\s*id.*wrong|not\s*authorized.*tool|incompatible\s*toolkit/i.test(
      msg,
    )
  ) {
    return "toolkit_mismatch"
  }
  return null
}

/**
 * Normalize either shape of Composio result (thrown error or resolved
 * `{ successful, error }` object) into a classification. The `timedOut`
 * flag is set by the route when its own timer wins the race.
 */
export function classifyProbeResult(input: {
  resolved?: unknown
  threw?: unknown
  timedOut?: boolean
}): ProbeClassification {
  if (input.timedOut) {
    return { category: "timeout", message: "Probe exceeded 5s budget" }
  }

  if (input.threw !== undefined) {
    const payload = extractErrorPayload(input.threw)
    const cat = classifyByMessage(payload)
    if (cat) return { category: cat, message: payload.slice(0, 280) }
    return { category: "unknown", message: `SDK threw: ${payload.slice(0, 240)}` }
  }

  const r = input.resolved as { successful?: boolean; error?: string } | null | undefined
  if (r?.successful === true) {
    return { category: "working", message: "OK" }
  }

  const errStr = typeof r?.error === "string" ? r.error : JSON.stringify(r ?? null)
  const cat = classifyByMessage(errStr)
  if (cat) return { category: cat, message: errStr.slice(0, 280) }
  return { category: "unknown", message: `Unclassified: ${errStr.slice(0, 240)}` }
}
