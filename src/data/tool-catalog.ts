export type ToolConnectionType = "API_KEY" | "OAUTH_COMPOSIO"

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
  { slug: "youtube-data-api", name: "YouTube Data API", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://console.cloud.google.com/apis/credentials", keyPlaceholder: "AIza...", credentialFields: singleApiKey("YOUTUBE_DATA_API_KEY", { placeholder: "AIza..." }) },
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
  { slug: "hubspot", name: "HubSpot", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "hubspot", description: "CRM pipeline management", credentialFields: [] },
  { slug: "salesforce", name: "Salesforce", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "salesforce", description: "CRM data access (OAuth via Composio)", credentialFields: [] },
  { slug: "gmail", name: "Gmail", connectionType: "OAUTH_COMPOSIO", category: "EMAIL", composioToolkitId: "gmail", description: "Email sending and monitoring", credentialFields: [] },
  { slug: "google_calendar", name: "Google Calendar", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "googlecalendar", description: "Calendar events", credentialFields: [] },
  { slug: "google-analytics", name: "Google Analytics", connectionType: "OAUTH_COMPOSIO", category: "ANALYTICS", composioToolkitId: "google_analytics", description: "Analytics data", credentialFields: [] },
  { slug: "slack", name: "Slack", connectionType: "OAUTH_COMPOSIO", category: "MESSAGING", composioToolkitId: "slack", description: "Team messaging", credentialFields: [] },
  { slug: "github", name: "GitHub", connectionType: "OAUTH_COMPOSIO", category: "DEVELOPMENT", composioToolkitId: "github", description: "Repos and issues", credentialFields: [] },
  { slug: "linear", name: "Linear", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "linear", description: "Issue tracking", credentialFields: [] },
  { slug: "asana", name: "Asana", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "asana", description: "Project management", credentialFields: [] },
  { slug: "clickup", name: "ClickUp", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "clickup", description: "Project management", credentialFields: [] },
  { slug: "notion", name: "Notion", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "notion", description: "Docs and wikis", credentialFields: [] },
  { slug: "linkedin", name: "LinkedIn", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "linkedin", description: "Professional networking", credentialFields: [] },
  { slug: "twitter", name: "Twitter/X", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "twitter", description: "Social media", credentialFields: [] },
  { slug: "convertkit", name: "ConvertKit", connectionType: "OAUTH_COMPOSIO", category: "NEWSLETTER", composioToolkitId: "kit", description: "Email marketing (Composio slug is `kit` post-2024 rebrand)", credentialFields: [] },
  { slug: "shopify", name: "Shopify", connectionType: "OAUTH_COMPOSIO", category: "ECOMMERCE", composioToolkitId: "shopify", description: "E-commerce platform", credentialFields: [] },
  { slug: "jira", name: "Jira", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "jira", description: "Issue tracking", credentialFields: [] },
  { slug: "calendly", name: "Calendly", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "calendly", description: "Scheduling", credentialFields: [] },
]

export const ALL_TOOLS: ToolDefinition[] = [...API_KEY_TOOLS, ...OAUTH_TOOLS]

export const TOOL_CATEGORIES = [
  "All", "AI", "CRM", "EMAIL", "SEARCH", "SOCIAL", "ANALYTICS", "CALENDAR",
  "LEAD_DATABASE", "TRADING", "PAYMENTS", "SEO", "DEVELOPMENT", "PROJECT_MANAGEMENT",
  "NEWSLETTER", "ECOMMERCE", "CMS", "MESSAGING", "SMS", "DOCS", "VOICE", "IMAGES",
] as const

export function getToolBySlug(slug: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.slug === slug)
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.name.toLowerCase()))
}

export function getToolsByCategory(category: string): ToolDefinition[] {
  return ALL_TOOLS.filter((t) => t.category === category)
}

/**
 * Returns the primary credential field for a tool. Used for keyHint display
 * and backfill (the primary field is the one that legacy encryptedApiKey
 * mapped to). Returns undefined for tools without declared fields (e.g.,
 * OAUTH_COMPOSIO tools).
 */
export function getPrimaryCredentialField(toolSlug: string): ToolCredentialField | undefined {
  const tool = getToolBySlug(toolSlug)
  if (!tool) return undefined
  return tool.credentialFields.find((f) => f.primary)
}
