export type ToolConnectionType = "API_KEY" | "OAUTH_COMPOSIO"

/**
 * PR2.9-fix1: how an OAUTH_COMPOSIO tool actually authenticates with
 * Composio. The wizard + Browse modal use this to render the correct
 * button label at first paint, without waiting for a server round-trip.
 *
 *   - `managed-oauth`         Composio holds OAuth credentials and runs
 *                              the consent flow. Button: "Connect with OAuth".
 *   - `byok-api-key`          User supplies their own API key; Composio
 *                              brokers (PR2.9). Button: "Enter API key".
 *   - `custom-oauth-required` Composio offers no managed scheme AND no
 *                              API_KEY mode (twitter, docusign). Operator
 *                              must register a custom OAuth app in the
 *                              Composio dashboard. Catalog entry stays
 *                              `comingSoon: true` until that's done; no
 *                              connect button rendered.
 *
 * Server-side classification (`classifyToolkitAuthMode` in
 * src/lib/composio-auth-config.ts) reads Composio metadata at request
 * time and is the runtime source of truth for the initiate route. The
 * catalog `authMode` field mirrors that classification statically so
 * client renders don't need a metadata round-trip per tool — kept in
 * sync via `scripts/pr2.8a-composio-authconfig-probe.mjs --byok-eligibility`
 * and the `tool-catalog-slug-drift.test.ts` invariants.
 */
export type ToolAuthMode = "managed-oauth" | "byok-api-key" | "custom-oauth-required"

/**
 * One credential input for a tool. `envVar` is the env-var name OpenClaw's
 * skill will read at runtime (`$TAVILY_API_KEY`, `$BINANCE_API_SECRET`, …).
 * Single-credential tools have one field with `primary: true`; multi-cred
 * tools have 2–3 fields with exactly one marked primary (used for keyHint).
 */
export interface ToolCredentialField {
  /** Env var name the container skill expects (uppercase_snake_case). */
  envVar: string
  /** Human label shown next to the input in CredentialsModal. */
  label: string
  /** Whether the save path rejects the submission when this field is blank. */
  required: boolean
  /** Exactly one field per tool is primary (used for keyHint + backfill). */
  primary: boolean
  /** Provider docs URL for this specific field (falls back to tool.helpUrl). */
  helpUrl?: string
  /** Placeholder shown in the input. */
  placeholder?: string
}

export interface ToolDefinition {
  slug: string
  name: string
  connectionType: ToolConnectionType
  category: string
  helpUrl?: string
  /** @deprecated Use credentialFields[0].placeholder. Kept for UI back-compat. */
  keyPlaceholder?: string
  composioToolkitId?: string
  description?: string
  isAIProvider?: boolean
  /**
   * Required for `connectionType: "OAUTH_COMPOSIO"` entries; absent for
   * direct API_KEY tools. Drives the connect-button label at render time.
   * Tested by `tool-catalog-slug-drift.test.ts`: every OAUTH_COMPOSIO
   * entry must declare this.
   */
  authMode?: ToolAuthMode
  /**
   * Reserved catalog slot for a tool whose integration isn't built yet
   * (PR2.8c direct integrations + pending partner-program approvals).
   * Default false. True entries are filtered out of the wizard render
   * list by the resolver at setup time, but remain valid slug references
   * so seed data + oneOf-style `alternatives` arrays can name them.
   */
  comingSoon?: boolean
  /**
   * Optional operator-facing reason shown in the "coming soon" UI once
   * PR2.8b lands its badge rendering. Ignored if `comingSoon` is false.
   */
  comingSoonReason?: string
  /**
   * True for entries that exist only to preserve historical
   * `ToolConnection` rows under a legacy slug (see `youtube-data-api`
   * after PR2.8a — replaced by `youtube` OAUTH_COMPOSIO). Templates
   * should not reference deprecated slugs; the slug-drift test flags
   * any references. Not rendered in the catalog browse UI.
   */
  deprecated?: boolean
  /**
   * Credential input fields. API_KEY tools declare one entry per env var the
   * container skill needs (single-cred = 1 entry; multi-cred = 2-3 entries).
   * OAUTH_COMPOSIO tools leave this empty: their credentials are held by
   * Composio, not by us (see docs/COMPOSIO_RUNTIME_CONTRACT.md).
   */
  credentialFields: ToolCredentialField[]
}

// Helper for single-credential API_KEY tools: one required primary field
// with the conventional "API Key" label.
function singleApiKey(
  envVar: string,
  opts: { label?: string; placeholder?: string; helpUrl?: string } = {},
): ToolCredentialField[] {
  return [
    {
      envVar,
      label: opts.label ?? "API Key",
      required: true,
      primary: true,
      ...(opts.placeholder !== undefined && { placeholder: opts.placeholder }),
      ...(opts.helpUrl !== undefined && { helpUrl: opts.helpUrl }),
    },
  ]
}

export const API_KEY_TOOLS: ToolDefinition[] = [
  { slug: "anthropic_api", name: "Anthropic (Claude)", connectionType: "API_KEY", category: "AI", helpUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-api03-...", isAIProvider: true, credentialFields: singleApiKey("ANTHROPIC_API_KEY", { placeholder: "sk-ant-api03-..." }) },
  { slug: "tavily", name: "Tavily (Web Search)", connectionType: "API_KEY", category: "SEARCH", helpUrl: "https://tavily.com/#api", keyPlaceholder: "tvly-...", description: "AI-optimized web search", credentialFields: singleApiKey("TAVILY_API_KEY", { placeholder: "tvly-..." }) },
  { slug: "serp_api", name: "SerpAPI", connectionType: "API_KEY", category: "SEARCH", helpUrl: "https://serpapi.com/manage-api-key", keyPlaceholder: "serp_...", description: "Google search results API", credentialFields: singleApiKey("SERPAPI_API_KEY", { placeholder: "serp_..." }) },
  { slug: "exa_search", name: "Exa", connectionType: "API_KEY", category: "SEARCH", helpUrl: "https://exa.ai/settings", description: "AI-powered web search", credentialFields: singleApiKey("EXA_API_KEY") },
  { slug: "brave_search", name: "Brave Search", connectionType: "API_KEY", category: "SEARCH", helpUrl: "https://brave.com/search/api/", description: "Privacy-focused web search API", credentialFields: singleApiKey("BRAVE_SEARCH_API_KEY") },
  { slug: "apollo", name: "Apollo.io", connectionType: "API_KEY", category: "LEAD_DATABASE", helpUrl: "https://app.apollo.io/settings/integrations/api", keyPlaceholder: "sk-apollo-...", credentialFields: singleApiKey("APOLLO_API_KEY", { placeholder: "sk-apollo-..." }) },
  { slug: "clay", name: "Clay.com", connectionType: "API_KEY", category: "LEAD_DATABASE", helpUrl: "https://app.clay.com/settings/api", keyPlaceholder: "clay_...", credentialFields: singleApiKey("CLAY_API_KEY", { placeholder: "clay_..." }) },
  { slug: "instantly", name: "Instantly.ai", connectionType: "API_KEY", category: "EMAIL", helpUrl: "https://app.instantly.ai/settings/api", keyPlaceholder: "inst_...", description: "Cold email outreach", credentialFields: singleApiKey("INSTANTLY_API_KEY", { placeholder: "inst_..." }) },
  { slug: "sendgrid", name: "SendGrid", connectionType: "API_KEY", category: "EMAIL", helpUrl: "https://app.sendgrid.com/settings/api_keys", keyPlaceholder: "SG...", description: "Transactional and marketing email", credentialFields: singleApiKey("SENDGRID_API_KEY", { placeholder: "SG..." }) },
  { slug: "mailgun", name: "Mailgun", connectionType: "API_KEY", category: "EMAIL", helpUrl: "https://app.mailgun.com/settings/api_security", description: "Email delivery service", credentialFields: singleApiKey("MAILGUN_API_KEY") },
  { slug: "cal_com", name: "Cal.com", connectionType: "API_KEY", category: "CALENDAR", helpUrl: "https://app.cal.com/settings/developer/api-keys", description: "Open source scheduling", credentialFields: singleApiKey("CAL_COM_API_KEY") },
  { slug: "stripe_api", name: "Stripe", connectionType: "API_KEY", category: "PAYMENTS", helpUrl: "https://dashboard.stripe.com/apikeys", keyPlaceholder: "sk_live_...", credentialFields: singleApiKey("STRIPE_API_KEY", { placeholder: "sk_live_..." }) },
  { slug: "polymarket", name: "Polymarket", connectionType: "API_KEY", category: "TRADING", helpUrl: "https://polymarket.com/settings", keyPlaceholder: "pm_...", credentialFields: singleApiKey("POLYMARKET_API_KEY", { placeholder: "pm_..." }) },
  {
    slug: "binance",
    name: "Binance",
    connectionType: "API_KEY",
    category: "TRADING",
    helpUrl: "https://www.binance.com/en/my/settings/api-management",
    credentialFields: [
      { envVar: "BINANCE_API_KEY", label: "API Key", required: true, primary: true },
      { envVar: "BINANCE_API_SECRET", label: "API Secret", required: true, primary: false },
    ],
  },
  {
    slug: "alpaca",
    name: "Alpaca",
    connectionType: "API_KEY",
    category: "TRADING",
    helpUrl: "https://app.alpaca.markets/paper/dashboard/overview",
    credentialFields: [
      { envVar: "ALPACA_API_KEY_ID", label: "API Key ID", required: true, primary: true },
      { envVar: "ALPACA_API_SECRET_KEY", label: "API Secret Key", required: true, primary: false },
    ],
  },
  {
    slug: "coinbase",
    name: "Coinbase Exchange",
    connectionType: "API_KEY",
    category: "TRADING",
    helpUrl: "https://exchange.coinbase.com/profile/api",
    description: "Coinbase Exchange (formerly Coinbase Pro) — key + secret + passphrase",
    credentialFields: [
      { envVar: "COINBASE_API_KEY", label: "API Key", required: true, primary: true },
      { envVar: "COINBASE_API_SECRET", label: "API Secret", required: true, primary: false },
      { envVar: "COINBASE_API_PASSPHRASE", label: "API Passphrase", required: true, primary: false },
    ],
  },
  /**
   * @deprecated PR2.8a. Use `youtube` (OAUTH_COMPOSIO) instead — it wraps
   * the same YouTube Data API v3 scopes but authenticates via managed
   * OAuth rather than a raw API key, which eliminates the Google Cloud
   * project + quota management burden from the user.
   *
   * Kept in the catalog for historical `ToolConnection` rows tied to this
   * slug. Templates must not reference it; `template-tool-references.test.ts`
   * enforces this. Removable in a later PR once prod has zero connections
   * on this slug (today's prod has none per the PR2.8a state 1 probe).
   */
  { slug: "youtube-data-api", name: "YouTube Data API", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://console.cloud.google.com/apis/credentials", keyPlaceholder: "AIza...", deprecated: true, credentialFields: singleApiKey("YOUTUBE_DATA_API_KEY", { placeholder: "AIza..." }) },
  { slug: "twitter-api", name: "Twitter/X API", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://developer.x.com/en/portal/dashboard", description: "Social media posting and monitoring", credentialFields: singleApiKey("TWITTER_API_KEY", { label: "Bearer Token" }) },
  { slug: "google-search-console", name: "Google Search Console", connectionType: "API_KEY", category: "SEO", helpUrl: "https://console.cloud.google.com/apis/credentials", credentialFields: singleApiKey("GSC_API_KEY") },
  { slug: "ahrefs", name: "Ahrefs", connectionType: "API_KEY", category: "SEO", helpUrl: "https://ahrefs.com/api", credentialFields: singleApiKey("AHREFS_API_KEY") },
  { slug: "semrush", name: "SEMrush", connectionType: "API_KEY", category: "SEO", helpUrl: "https://www.semrush.com/api/", credentialFields: singleApiKey("SEMRUSH_API_KEY") },
  {
    slug: "twilio",
    name: "Twilio",
    connectionType: "API_KEY",
    category: "SMS",
    helpUrl: "https://console.twilio.com/",
    description: "SMS + voice via Twilio REST API (Account SID + Auth Token, HTTP Basic auth)",
    credentialFields: [
      { envVar: "TWILIO_ACCOUNT_SID", label: "Account SID", required: true, primary: true, placeholder: "ACxxxxxxxxxxxx..." },
      { envVar: "TWILIO_AUTH_TOKEN", label: "Auth Token", required: true, primary: false, placeholder: "Your Twilio auth token" },
    ],
  },
  { slug: "posthog", name: "PostHog", connectionType: "API_KEY", category: "ANALYTICS", helpUrl: "https://app.posthog.com/settings/project-details", description: "Product analytics", credentialFields: singleApiKey("POSTHOG_API_KEY") },
  { slug: "mixpanel", name: "Mixpanel", connectionType: "API_KEY", category: "ANALYTICS", helpUrl: "https://mixpanel.com/settings/project", description: "Event-based analytics", credentialFields: singleApiKey("MIXPANEL_API_SECRET", { label: "API Secret" }) },
  { slug: "elevenlabs", name: "ElevenLabs", connectionType: "API_KEY", category: "VOICE", helpUrl: "https://elevenlabs.io/settings/api", credentialFields: singleApiKey("ELEVENLABS_API_KEY") },
  { slug: "stabilityai", name: "Stability AI", connectionType: "API_KEY", category: "IMAGES", helpUrl: "https://platform.stability.ai/account/keys", credentialFields: singleApiKey("STABILITY_API_KEY") },
  { slug: "vidiq", name: "VidIQ", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://vidiq.com/settings", credentialFields: singleApiKey("VIDIQ_API_KEY") },
  // Direct-token alternates to OAUTH tools. The OAuth-managed slugs
  // (salesforce, beehiiv) remain in OAUTH_TOOLS below; these parallel
  // entries let users who already have a Salesforce session token or a
  // Beehiiv API key connect directly without going through Composio.
  // See GH #27 / COMPOSIO_RUNTIME_CONTRACT.md for why parallel entries.
  {
    slug: "salesforce-api",
    name: "Salesforce (API Token)",
    connectionType: "API_KEY",
    category: "CRM",
    helpUrl: "https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_user_credentials_flow.htm",
    description: "Direct-token connection for Salesforce (alternative to the OAuth-managed 'salesforce' entry)",
    credentialFields: [
      { envVar: "SALESFORCE_INSTANCE_URL", label: "Instance URL", required: true, primary: true, placeholder: "https://your-domain.my.salesforce.com" },
      { envVar: "SALESFORCE_ACCESS_TOKEN", label: "Access Token", required: true, primary: false },
    ],
  },
  {
    slug: "beehiiv-api",
    name: "Beehiiv (API Key)",
    connectionType: "API_KEY",
    category: "NEWSLETTER",
    helpUrl: "https://developers.beehiiv.com/docs/v2/wnlzmbdbbzxe0-v-2-authentication",
    description: "Direct-token connection for Beehiiv (alternative to the OAuth-managed 'beehiiv' entry)",
    credentialFields: [
      { envVar: "BEEHIIV_PUBLICATION_ID", label: "Publication ID", required: true, primary: true, placeholder: "pub_..." },
      { envVar: "BEEHIIV_API_KEY", label: "API Key", required: true, primary: false },
    ],
  },
]

// OAuth-managed tools (via Composio). Each entry's `composioToolkitId` must be
// a real toolkit slug on Composio's backend — verified by paginated audit of
// Composio's toolkit list during PR #4's pre-flight
// (C:\temp\composio-poc\21-scope-audit.mjs, raw results in
//  21-scope-audit-raw.json).
//
// Four previously-listed OAuth tools (`buffer`, `beehiiv`, `substack`,
// `wordpress`) were removed because Composio does not publish matching
// toolkits — advertising a Connect button that 404s at
// `composio.toolkits.get(slug)` is worse than not offering the integration.
// Users needing these integrations can connect via Custom API keys once
// PR #6's Custom API pipeline ships (tracked in the umbrella GH issue
// "Template seed data drift — multiple pre-existing inconsistencies").
// `beehiiv-api` remains available in API_KEY_TOOLS as a direct-token path.
//
// Two slug drifts were corrected:
//   - google_calendar: catalog slug stays `google_calendar` (user-facing,
//     already in DB rows); composioToolkitId fixed to `googlecalendar`
//     (Composio's actual slug — no underscore).
//   - convertkit: catalog slug stays `convertkit` (ConvertKit is the
//     brand name the user knows); composioToolkitId fixed to `kit`
//     (Composio follows the 2024 vendor rebrand to "Kit").
export const OAUTH_TOOLS: ToolDefinition[] = [
  // PR2.9-fix1: `authMode` field added on every OAUTH_COMPOSIO entry.
  // Values sourced from a full audit run of
  // `scripts/pr2.8a-composio-authconfig-probe.mjs --byok-eligibility`
  // against staging Composio (2026-05-21). See PR2.9-fix1 description for
  // the audit table. Re-run the probe + update this field whenever
  // Composio changes a toolkit's auth posture (e.g., adds managed-OAuth
  // to a toolkit that was previously BYOK-only).
  //
  // Dual-mode managed-OAuth toolkits (hubspot, linear, clickup, notion,
  // convertkit/kit, jira) ALSO expose API_KEY on Composio. We classify
  // them as `managed-oauth` because that's the user-preferred flow
  // (no token to manage). "BYOK fallback for OAuth toolkits" is tracked
  // at GH#77.
  { slug: "hubspot", name: "HubSpot", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "hubspot", authMode: "managed-oauth", description: "CRM pipeline management", credentialFields: [] },
  { slug: "salesforce", name: "Salesforce", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "salesforce", authMode: "managed-oauth", description: "CRM data access (OAuth via Composio)", credentialFields: [] },
  { slug: "gmail", name: "Gmail", connectionType: "OAUTH_COMPOSIO", category: "EMAIL", composioToolkitId: "gmail", authMode: "managed-oauth", description: "Email sending and monitoring", credentialFields: [] },
  { slug: "google_calendar", name: "Google Calendar", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "googlecalendar", authMode: "managed-oauth", description: "Calendar events", credentialFields: [] },
  { slug: "google-analytics", name: "Google Analytics", connectionType: "OAUTH_COMPOSIO", category: "ANALYTICS", composioToolkitId: "google_analytics", authMode: "managed-oauth", description: "Analytics data", credentialFields: [] },
  { slug: "slack", name: "Slack", connectionType: "OAUTH_COMPOSIO", category: "MESSAGING", composioToolkitId: "slack", authMode: "managed-oauth", description: "Team messaging", credentialFields: [] },
  { slug: "github", name: "GitHub", connectionType: "OAUTH_COMPOSIO", category: "DEVELOPMENT", composioToolkitId: "github", authMode: "managed-oauth", description: "Repos and issues", credentialFields: [] },
  { slug: "linear", name: "Linear", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "linear", authMode: "managed-oauth", description: "Issue tracking", credentialFields: [] },
  { slug: "asana", name: "Asana", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "asana", authMode: "managed-oauth", description: "Project management", credentialFields: [] },
  { slug: "clickup", name: "ClickUp", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "clickup", authMode: "managed-oauth", description: "Project management", credentialFields: [] },
  { slug: "notion", name: "Notion", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "notion", authMode: "managed-oauth", description: "Docs and wikis", credentialFields: [] },
  { slug: "linkedin", name: "LinkedIn", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "linkedin", authMode: "managed-oauth", description: "Professional networking", credentialFields: [] },
  // OAuth-only on Composio (no API_KEY mode, no managed-OAuth available) —
  // operator must register a custom OAuth app with Twitter/X Developer
  // before this toolkit becomes connectable. PR2.9 BYOK doesn't unblock
  // it because there's no API_KEY mode to broker. Tracked in
  // docs/COMPOSIO_RUNTIME_CONTRACT.md "Custom OAuth toolkits (operator tracker)".
  { slug: "twitter", name: "Twitter/X", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "twitter", authMode: "custom-oauth-required", description: "Social media", comingSoon: true, comingSoonReason: "OAuth-only on Composio; operator registering with Twitter Developer this week", credentialFields: [] },
  { slug: "convertkit", name: "ConvertKit", connectionType: "OAUTH_COMPOSIO", category: "NEWSLETTER", composioToolkitId: "kit", authMode: "managed-oauth", description: "Email marketing (Composio slug is `kit` post-2024 rebrand)", credentialFields: [] },
  { slug: "shopify", name: "Shopify", connectionType: "OAUTH_COMPOSIO", category: "ECOMMERCE", composioToolkitId: "shopify", authMode: "byok-api-key", description: "E-commerce platform", credentialFields: [] },
  { slug: "jira", name: "Jira", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "jira", authMode: "managed-oauth", description: "Issue tracking", credentialFields: [] },
  { slug: "calendly", name: "Calendly", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "calendly", authMode: "managed-oauth", description: "Scheduling", credentialFields: [] },
  // ─── PR2.8a additions (19) ───
  // Every composioToolkitId verified against tmp/composio-toolkits.txt at audit
  // time (Composio API snapshot 2026-04-29; 1030 toolkits dumped).
  //
  // PR2.9 update: auth-mode routing now classifies each entry at runtime
  // via `classifyToolkitAuthMode(composio.toolkits.get(slug))`:
  //   - managed-oauth  → Composio's own OAuth credentials (Gmail, Slack,
  //                       Notion, Google Drive, etc.). Wizard runs the
  //                       popup-and-poll flow.
  //   - byok-api-key   → BYOK: user supplies their own API key, Composio
  //                       brokers. Wizard shows an inline credentials
  //                       form, no popup. Covers typefully, jotform,
  //                       toggl (API_KEY-only on Composio) AND the dual-
  //                       mode toolkits we ship via API_KEY for now
  //                       (shopify, lever, metaads, pipedrive, webflow,
  //                       follow_up_boss). Custom OAuth registration
  //                       remains an OPTIONAL future upgrade for these
  //                       six, not a launch prerequisite.
  //   - requires-custom-oauth → no API_KEY mode + no managed scheme.
  //                       Operator must register a custom OAuth app in
  //                       Composio dashboard. Today: twitter, docusign.
  //                       Catalog entry stays `comingSoon: true`.
  //
  // All entries below remain `connectionType: "OAUTH_COMPOSIO"` because
  // Composio still brokers the credential at execute time regardless of
  // the underlying auth scheme — the `_COMPOSIO` suffix names the
  // broker, not the protocol. The runtime route (`oauth/initiate`)
  // dispatches managed-oauth vs byok-api-key via the classifier.
  //
  // Categories chosen from TOOL_CATEGORIES; where no perfect category exists
  // (ads, time tracking, forms) we picked the closest existing bucket rather
  // than invent new categories. PR2.8b revisit tracked in
  // docs/PR2.8_AUDIT_DECISIONS.md.
  { slug: "typefully", name: "Typefully", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "typefully", authMode: "byok-api-key", description: "Twitter/X content scheduling", credentialFields: [] },
  // OAuth-only on Composio (no API_KEY mode). PR2.9 BYOK can't unblock —
  // operator must register a custom OAuth app at DocuSign Developer.
  { slug: "docusign", name: "DocuSign", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "docusign", authMode: "custom-oauth-required", description: "E-signature and document workflows", comingSoon: true, comingSoonReason: "OAuth-only on Composio; operator registering custom app with DocuSign Developer", credentialFields: [] },
  { slug: "follow_up_boss", name: "Follow Up Boss", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "follow_up_boss", authMode: "byok-api-key", description: "Real estate CRM", credentialFields: [] },
  { slug: "freshbooks", name: "FreshBooks", connectionType: "OAUTH_COMPOSIO", category: "PAYMENTS", composioToolkitId: "freshbooks", authMode: "managed-oauth", description: "Small-business accounting and invoicing", credentialFields: [] },
  { slug: "gitlab", name: "GitLab", connectionType: "OAUTH_COMPOSIO", category: "DEVELOPMENT", composioToolkitId: "gitlab", authMode: "managed-oauth", description: "Repos, issues, and CI", credentialFields: [] },
  { slug: "googleads", name: "Google Ads", connectionType: "OAUTH_COMPOSIO", category: "ANALYTICS", composioToolkitId: "googleads", authMode: "managed-oauth", description: "Google Ads campaigns and reporting", credentialFields: [] },
  { slug: "googledocs", name: "Google Docs", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "googledocs", authMode: "managed-oauth", description: "Google Docs read/write", credentialFields: [] },
  { slug: "googledrive", name: "Google Drive", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "googledrive", authMode: "managed-oauth", description: "Google Drive file storage", credentialFields: [] },
  { slug: "harvest", name: "Harvest", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "harvest", authMode: "managed-oauth", description: "Time tracking and invoicing", credentialFields: [] },
  { slug: "jotform", name: "Jotform", connectionType: "OAUTH_COMPOSIO", category: "LEAD_DATABASE", composioToolkitId: "jotform", authMode: "byok-api-key", description: "Form builder and submissions", credentialFields: [] },
  { slug: "lever", name: "Lever", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "lever", authMode: "byok-api-key", description: "Recruiting ATS", credentialFields: [] },
  { slug: "metaads", name: "Meta Ads", connectionType: "OAUTH_COMPOSIO", category: "ANALYTICS", composioToolkitId: "metaads", authMode: "byok-api-key", description: "Meta (Facebook + Instagram) ads campaigns and reporting", credentialFields: [] },
  { slug: "outlook", name: "Outlook", connectionType: "OAUTH_COMPOSIO", category: "EMAIL", composioToolkitId: "outlook", authMode: "managed-oauth", description: "Microsoft Outlook email", credentialFields: [] },
  { slug: "pipedrive", name: "Pipedrive", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "pipedrive", authMode: "byok-api-key", description: "Sales CRM", credentialFields: [] },
  { slug: "quickbooks", name: "QuickBooks", connectionType: "OAUTH_COMPOSIO", category: "PAYMENTS", composioToolkitId: "quickbooks", authMode: "managed-oauth", description: "Small-business accounting", credentialFields: [] },
  { slug: "toggl", name: "Toggl", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "toggl", authMode: "byok-api-key", description: "Time tracking", credentialFields: [] },
  { slug: "typeform", name: "Typeform", connectionType: "OAUTH_COMPOSIO", category: "LEAD_DATABASE", composioToolkitId: "typeform", authMode: "managed-oauth", description: "Form builder and responses", credentialFields: [] },
  { slug: "webflow", name: "Webflow", connectionType: "OAUTH_COMPOSIO", category: "CMS", composioToolkitId: "webflow", authMode: "byok-api-key", description: "Visual web publishing", credentialFields: [] },
  { slug: "youtube", name: "YouTube", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "youtube", authMode: "managed-oauth", description: "YouTube channel management (replaces youtube-data-api API_KEY path)", credentialFields: [] },
]

// PR2.8a Task 3: placeholder catalog entries for direct integrations
// arriving in PR2.8c + three pending partner-program entries. Every row has
// `comingSoon: true` — the wizard resolver filters these from render. Slugs
// are reserved here so seed data and `alternatives` arrays can reference
// them now; each entry graduates out of this array into API_KEY_TOOLS or
// OAUTH_TOOLS as its integration ships.
//
// `connectionType: "API_KEY"` is a placeholder. Several of these will land
// as OAuth when PR2.8c builds them (Clio, ServiceTitan, etc.), which
// will either require adding a third connectionType member or implementing
// the OAuth-direct flow through the API_KEY token-based path. That's a
// PR2.8c decision; keeping connectionType uniform here prevents the
// wizard from accidentally routing placeholders to the OAuth path.
//
// `credentialFields: []` is intentional — no fields are wired yet.
// `comingSoonReason` surfaces in the PR2.8b "Coming Soon" badge UI.
export const COMING_SOON_TOOLS: ToolDefinition[] = [
  // Direct integrations shipping in PR2.8c (16)
  { slug: "buffer", name: "Buffer", connectionType: "API_KEY", category: "SOCIAL", description: "Social media scheduling across platforms", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "wordpress", name: "WordPress", connectionType: "API_KEY", category: "CMS", description: "Self-hosted WordPress via URL + application password", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "amazon_sp_api", name: "Amazon SP-API", connectionType: "API_KEY", category: "ECOMMERCE", description: "Amazon Selling Partner API (Login with Amazon OAuth)", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "greenhouse", name: "Greenhouse", connectionType: "API_KEY", category: "CRM", description: "Recruiting ATS", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "clio", name: "Clio", connectionType: "API_KEY", category: "CRM", description: "Legal practice management", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "mycase", name: "MyCase", connectionType: "API_KEY", category: "CRM", description: "Legal practice management", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "servicetitan", name: "ServiceTitan", connectionType: "API_KEY", category: "CRM", description: "Field service dispatch and invoicing", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "housecall_pro", name: "Housecall Pro", connectionType: "API_KEY", category: "CRM", description: "Home-services dispatch", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "drchrono", name: "DrChrono", connectionType: "API_KEY", category: "CRM", description: "Medical practice management and EHR", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "google_business_profile", name: "Google Business Profile", connectionType: "API_KEY", category: "ANALYTICS", description: "Local business listings + reviews", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "bullhorn", name: "Bullhorn", connectionType: "API_KEY", category: "CRM", description: "Staffing and recruiting ATS", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "snyk", name: "Snyk", connectionType: "API_KEY", category: "DEVELOPMENT", description: "Developer-first security scanning", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "keepa", name: "Keepa", connectionType: "API_KEY", category: "ECOMMERCE", description: "Amazon price and sales-rank history", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "sparkloop", name: "SparkLoop", connectionType: "API_KEY", category: "NEWSLETTER", description: "Newsletter cross-promotion and paid referrals", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "kraken", name: "Kraken", connectionType: "API_KEY", category: "TRADING", description: "Cryptocurrency exchange (API key + secret)", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  { slug: "apple_calendar", name: "Apple Calendar (CalDAV)", connectionType: "API_KEY", category: "CALENDAR", description: "Apple Calendar via CalDAV (URL + username + app password)", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
  // Pending partner-program approvals (3)
  { slug: "athena_health", name: "Athenahealth", connectionType: "API_KEY", category: "CRM", description: "Medical practice management and EHR", comingSoon: true, comingSoonReason: "Pending API access approval", credentialFields: [] },
  { slug: "upwork", name: "Upwork", connectionType: "API_KEY", category: "LEAD_DATABASE", description: "Freelance marketplace", comingSoon: true, comingSoonReason: "Pending partner program approval", credentialFields: [] },
  { slug: "zillow", name: "Zillow", connectionType: "API_KEY", category: "CRM", description: "Real estate listings and leads", comingSoon: true, comingSoonReason: "Pending partner program approval", credentialFields: [] },
  // Orphan resolution (2) — previously referenced in seed alternatives without
  // a catalog backing; upgraded to placeholders here per PR2.8a decision.
  { slug: "kalshi", name: "Kalshi", connectionType: "API_KEY", category: "TRADING", description: "US-regulated event prediction market", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c (US-regulated prediction market alongside Polymarket)", credentialFields: [] },
  { slug: "smartlead", name: "Smartlead", connectionType: "API_KEY", category: "EMAIL", description: "Cold email outreach", comingSoon: true, comingSoonReason: "Direct integration arriving in PR2.8c", credentialFields: [] },
]

export const ALL_TOOLS: ToolDefinition[] = [...API_KEY_TOOLS, ...OAUTH_TOOLS, ...COMING_SOON_TOOLS]

/**
 * Hand-maintained literal-union list of every slug in `ALL_TOOLS`. Kept in
 * sync with `API_KEY_TOOLS` + `OAUTH_TOOLS` by the
 * `tool-catalog-slug-drift.test.ts` contract, which asserts
 * `ALL_TOOLS.map(t => t.slug).sort()` equals `[...ALL_TOOL_SLUGS].sort()`.
 *
 * Why hand-maintained instead of derived: TypeScript can't produce a literal
 * union from `ToolDefinition[]` (the element type erases `slug` to `string`).
 * Deriving from `as const satisfies readonly ToolDefinition[]` on the
 * constituent arrays would work but forces every call site to accept
 * `readonly ToolDefinition[]`. The hand-list + drift test is a smaller blast
 * radius.
 */
export const ALL_TOOL_SLUGS = [
  // API_KEY_TOOLS (29) — keep ordering aligned with the declaration above
  "anthropic_api",
  "tavily",
  "serp_api",
  "exa_search",
  "brave_search",
  "apollo",
  "clay",
  "instantly",
  "sendgrid",
  "mailgun",
  "cal_com",
  "stripe_api",
  "polymarket",
  "binance",
  "alpaca",
  "coinbase",
  "youtube-data-api",
  "twitter-api",
  "google-search-console",
  "ahrefs",
  "semrush",
  "twilio",
  "posthog",
  "mixpanel",
  "elevenlabs",
  "stabilityai",
  "vidiq",
  "salesforce-api",
  "beehiiv-api",
  // OAUTH_TOOLS (17)
  "hubspot",
  "salesforce",
  "gmail",
  "google_calendar",
  "google-analytics",
  "slack",
  "github",
  "linear",
  "asana",
  "clickup",
  "notion",
  "linkedin",
  "twitter",
  "convertkit",
  "shopify",
  "jira",
  "calendly",
  // PR2.8a Composio additions (19)
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
  // PR2.8a Task 3 placeholder additions (21)
  "buffer",
  "wordpress",
  "amazon_sp_api",
  "greenhouse",
  "clio",
  "mycase",
  "servicetitan",
  "housecall_pro",
  "drchrono",
  "google_business_profile",
  "bullhorn",
  "snyk",
  "keepa",
  "sparkloop",
  "kraken",
  "apple_calendar",
  "athena_health",
  "upwork",
  "zillow",
  "kalshi",
  "smartlead",
] as const

/**
 * Literal union of every catalog slug. Use this in template references,
 * seed data, and API request validators so new slugs get compile-time
 * coverage end-to-end.
 */
export type ToolSlug = (typeof ALL_TOOL_SLUGS)[number]

export const TOOL_CATEGORIES = [
  "All", "AI", "CRM", "EMAIL", "SEARCH", "SOCIAL", "ANALYTICS", "CALENDAR",
  "LEAD_DATABASE", "TRADING", "PAYMENTS", "SEO", "DEVELOPMENT", "PROJECT_MANAGEMENT",
  "NEWSLETTER", "ECOMMERCE", "CMS", "MESSAGING", "SMS", "DOCS", "VOICE", "IMAGES",
] as const

export function getToolBySlug(slug: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.slug === slug)
}

// PR2.8a removed:
//   - `TOOL_NAME_ALIASES` (PR2.7 map of "Claude API" -> "anthropic_api" etc.)
//   - `getToolByName` (bidirectional substring matcher)
// Templates now reference tools by slug directly via `ToolSlug`; the
// name-based resolver that substring-matched a display name back to a
// catalog entry is dead code. See `src/app/setup/[workspaceId]/step/[n]/page.tsx`
// (the only former production caller) which now uses `getToolBySlug` on the
// API response's slug field.

export function getToolsByCategory(category: string): ToolDefinition[] {
  return ALL_TOOLS.filter((t) => t.category === category)
}

/**
 * Returns the primary credential field for a tool. Used for keyHint display
 * and as the anchor env var when resolving single-credential connections.
 * Returns undefined for tools without declared fields (e.g.,
 * OAUTH_COMPOSIO tools).
 */
export function getPrimaryCredentialField(toolSlug: string): ToolCredentialField | undefined {
  const tool = getToolBySlug(toolSlug)
  if (!tool) return undefined
  return tool.credentialFields.find((f) => f.primary)
}
