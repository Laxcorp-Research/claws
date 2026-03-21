export type ToolConnectionType = "API_KEY" | "OAUTH_COMPOSIO"

export interface ToolDefinition {
  slug: string
  name: string
  connectionType: ToolConnectionType
  category: string
  helpUrl?: string
  keyPlaceholder?: string
  composioToolkitId?: string
  description?: string
}

export const API_KEY_TOOLS: ToolDefinition[] = [
  { slug: "anthropic_api", name: "Anthropic (Claude)", connectionType: "API_KEY", category: "AI", helpUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-api03-..." },
  { slug: "tavily", name: "Tavily (Web Search)", connectionType: "API_KEY", category: "SEARCH", helpUrl: "https://tavily.com/#api", keyPlaceholder: "tvly-..." },
  { slug: "apollo", name: "Apollo.io", connectionType: "API_KEY", category: "LEAD_DATABASE", helpUrl: "https://app.apollo.io/settings/integrations/api", keyPlaceholder: "sk-apollo-..." },
  { slug: "clay", name: "Clay.com", connectionType: "API_KEY", category: "LEAD_DATABASE", helpUrl: "https://app.clay.com/settings/api", keyPlaceholder: "clay_..." },
  { slug: "instantly", name: "Instantly.ai", connectionType: "API_KEY", category: "EMAIL", helpUrl: "https://app.instantly.ai/settings/api", keyPlaceholder: "inst_..." },
  { slug: "stripe_api", name: "Stripe", connectionType: "API_KEY", category: "PAYMENTS", helpUrl: "https://dashboard.stripe.com/apikeys", keyPlaceholder: "sk_live_..." },
  { slug: "polymarket", name: "Polymarket", connectionType: "API_KEY", category: "TRADING", helpUrl: "https://polymarket.com/settings", keyPlaceholder: "pm_..." },
  { slug: "binance", name: "Binance", connectionType: "API_KEY", category: "TRADING", helpUrl: "https://www.binance.com/en/my/settings/api-management" },
  { slug: "alpaca", name: "Alpaca", connectionType: "API_KEY", category: "TRADING", helpUrl: "https://app.alpaca.markets/paper/dashboard/overview" },
  { slug: "youtube_data", name: "YouTube Data API", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://console.cloud.google.com/apis/credentials", keyPlaceholder: "AIza..." },
  { slug: "gsc", name: "Google Search Console", connectionType: "API_KEY", category: "SEO", helpUrl: "https://console.cloud.google.com/apis/credentials" },
  { slug: "ahrefs", name: "Ahrefs", connectionType: "API_KEY", category: "SEO", helpUrl: "https://ahrefs.com/api" },
  { slug: "semrush", name: "SEMrush", connectionType: "API_KEY", category: "SEO", helpUrl: "https://www.semrush.com/api/" },
  { slug: "twilio", name: "Twilio", connectionType: "API_KEY", category: "SMS", helpUrl: "https://console.twilio.com/", keyPlaceholder: "SK..." },
  { slug: "elevenlabs", name: "ElevenLabs", connectionType: "API_KEY", category: "VOICE", helpUrl: "https://elevenlabs.io/settings/api" },
  { slug: "stabilityai", name: "Stability AI", connectionType: "API_KEY", category: "IMAGES", helpUrl: "https://platform.stability.ai/account/keys" },
  { slug: "vidiq", name: "VidIQ", connectionType: "API_KEY", category: "SOCIAL", helpUrl: "https://vidiq.com/settings" },
]

export const OAUTH_TOOLS: ToolDefinition[] = [
  { slug: "hubspot", name: "HubSpot", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "hubspot", description: "CRM pipeline management" },
  { slug: "salesforce", name: "Salesforce", connectionType: "OAUTH_COMPOSIO", category: "CRM", composioToolkitId: "salesforce", description: "CRM data access" },
  { slug: "gmail", name: "Gmail", connectionType: "OAUTH_COMPOSIO", category: "EMAIL", composioToolkitId: "gmail", description: "Email sending and monitoring" },
  { slug: "google_calendar", name: "Google Calendar", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "google_calendar", description: "Calendar events" },
  { slug: "google_analytics", name: "Google Analytics", connectionType: "OAUTH_COMPOSIO", category: "ANALYTICS", composioToolkitId: "google_analytics", description: "Analytics data" },
  { slug: "slack", name: "Slack", connectionType: "OAUTH_COMPOSIO", category: "MESSAGING", composioToolkitId: "slack", description: "Team messaging" },
  { slug: "github", name: "GitHub", connectionType: "OAUTH_COMPOSIO", category: "DEVELOPMENT", composioToolkitId: "github", description: "Repos and issues" },
  { slug: "buffer", name: "Buffer", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "buffer", description: "Social media scheduling" },
  { slug: "linear", name: "Linear", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "linear", description: "Issue tracking" },
  { slug: "asana", name: "Asana", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "asana", description: "Project management" },
  { slug: "clickup", name: "ClickUp", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "clickup", description: "Project management" },
  { slug: "notion", name: "Notion", connectionType: "OAUTH_COMPOSIO", category: "DOCS", composioToolkitId: "notion", description: "Docs and wikis" },
  { slug: "linkedin", name: "LinkedIn", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "linkedin", description: "Professional networking" },
  { slug: "twitter", name: "Twitter/X", connectionType: "OAUTH_COMPOSIO", category: "SOCIAL", composioToolkitId: "twitter", description: "Social media" },
  { slug: "beehiiv", name: "Beehiiv", connectionType: "OAUTH_COMPOSIO", category: "NEWSLETTER", composioToolkitId: "beehiiv", description: "Newsletter platform" },
  { slug: "substack", name: "Substack", connectionType: "OAUTH_COMPOSIO", category: "NEWSLETTER", composioToolkitId: "substack", description: "Newsletter platform" },
  { slug: "convertkit", name: "ConvertKit", connectionType: "OAUTH_COMPOSIO", category: "NEWSLETTER", composioToolkitId: "convertkit", description: "Email marketing" },
  { slug: "shopify", name: "Shopify", connectionType: "OAUTH_COMPOSIO", category: "ECOMMERCE", composioToolkitId: "shopify", description: "E-commerce platform" },
  { slug: "wordpress", name: "WordPress", connectionType: "OAUTH_COMPOSIO", category: "CMS", composioToolkitId: "wordpress", description: "Website management" },
  { slug: "jira", name: "Jira", connectionType: "OAUTH_COMPOSIO", category: "PROJECT_MANAGEMENT", composioToolkitId: "jira", description: "Issue tracking" },
  { slug: "calendly", name: "Calendly", connectionType: "OAUTH_COMPOSIO", category: "CALENDAR", composioToolkitId: "calendly", description: "Scheduling" },
]

export const ALL_TOOLS: ToolDefinition[] = [...API_KEY_TOOLS, ...OAUTH_TOOLS]

export const TOOL_CATEGORIES = [
  "All", "AI", "CRM", "EMAIL", "SEARCH", "SOCIAL", "ANALYTICS", "CALENDAR",
  "LEAD_DATABASE", "TRADING", "PAYMENTS", "SEO", "DEVELOPMENT", "PROJECT_MANAGEMENT",
  "NEWSLETTER", "ECOMMERCE", "CMS", "MESSAGING", "SMS", "DOCS",
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
