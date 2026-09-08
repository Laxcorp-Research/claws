import {
  COMPOSIO_EXECUTE_HOST,
  type HttpClass,
  type HttpEndpoint,
  type HttpSkillContract,
} from "@/lib/openclaw/http-contract"

function composioOp(operation: string, klass: HttpClass): HttpEndpoint {
  return {
    method: "POST",
    host: COMPOSIO_EXECUTE_HOST,
    path: `/api/v3/tools/execute/${operation}`,
    class: klass,
    operation,
  }
}

/** Toolkit prefix used to classify undeclared ops fail-closed at match time. */
export const COMPOSIO_OP_PREFIX_BY_SKILL: Readonly<Record<string, string>> = {
  "hubspot-crm": "HUBSPOT_",
  "salesforce-crm": "SALESFORCE_",
  "linkedin-api": "LINKEDIN_",
  "youtube-data-api": "YOUTUBE_",
  "convertkit-newsletter": "KIT_",
  "linear-pm": "LINEAR_",
  "asana-pm": "ASANA_",
  "clickup-pm": "CLICKUP_",
  "jira-pm": "JIRA_",
  "slack-messaging": "SLACK_",
  "notion-docs": "NOTION_",
  "google-analytics": "GOOGLE_ANALYTICS_",
  "calendly-scheduling": "CALENDLY_",
  "gmail-ops": "GMAIL_",
  "google-calendar": "GOOGLECALENDAR_",
  "github-ops": "GITHUB_",
  "twitter-oauth": "TWITTER_",
}

function withComposioPrefix(contract: HttpSkillContract): HttpSkillContract {
  if (contract.auth !== "composio") return contract
  const prefix = COMPOSIO_OP_PREFIX_BY_SKILL[contract.skill]
  if (!prefix) {
    throw new Error(`composio skill ${contract.skill} is missing COMPOSIO_OP_PREFIX_BY_SKILL`)
  }
  return { ...contract, composioOpPrefix: prefix }
}

/**
 * Declared READ/ACTION endpoints. A skill without a row is not callable
 * via the http rail (A5: badge "not yet callable").
 */
const SKILL_HTTP_CONTRACTS_RAW: Readonly<Record<string, HttpSkillContract>> = {
  "tavily-search": {
    skill: "tavily-search",
    auth: "tavily-body-key",
    endpoints: [
      { method: "POST", host: "api.tavily.com", path: "/search", class: "READ" },
      { method: "POST", host: "api.tavily.com", path: "/extract", class: "READ" },
    ],
  },
  "twitter-api": {
    skill: "twitter-api",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.twitter.com", path: "/2/tweets/search/recent", class: "READ" },
      { method: "GET", host: "api.x.com", path: "/2/tweets/search/recent", class: "READ" },
      { method: "GET", host: "api.twitter.com", path: "/2/tweets", class: "READ" },
      { method: "GET", host: "api.x.com", path: "/2/tweets", class: "READ" },
      { method: "GET", host: "api.twitter.com", path: "/2/users", class: "READ" },
      { method: "GET", host: "api.x.com", path: "/2/users", class: "READ" },
      { method: "POST", host: "api.twitter.com", path: "/2/tweets", class: "ACTION" },
      { method: "POST", host: "api.x.com", path: "/2/tweets", class: "ACTION" },
    ],
  },
  "alpaca-trading": {
    skill: "alpaca-trading",
    auth: "alpaca-dual-header",
    endpoints: [
      { method: "GET", host: "paper-api.alpaca.markets", path: "/v2/account", class: "READ" },
      { method: "GET", host: "paper-api.alpaca.markets", path: "/v2/positions", class: "READ" },
      { method: "GET", host: "paper-api.alpaca.markets", path: "/v2/clock", class: "READ" },
      { method: "GET", host: "data.alpaca.markets", path: "/v2/stocks", class: "READ" },
      { method: "POST", host: "paper-api.alpaca.markets", path: "/v2/orders", class: "ACTION" },
    ],
  },
  "hubspot-crm": {
    skill: "hubspot-crm",
    auth: "composio",
    endpoints: [
      composioOp("HUBSPOT_HUBSPOT_LIST_CONTACTS", "READ"),
      composioOp("HUBSPOT_CREATE_CONTACT", "ACTION"),
      composioOp("HUBSPOT_CREATE_DEAL", "ACTION"),
    ],
  },
  "salesforce-crm": {
    skill: "salesforce-crm",
    auth: "composio",
    endpoints: [
      composioOp("SALESFORCE_LIST_CONTACTS", "READ"),
      composioOp("SALESFORCE_CREATE_CONTACT", "ACTION"),
      composioOp("SALESFORCE_SEND_EMAIL", "ACTION"),
    ],
  },
  "apollo-search": {
    skill: "apollo-search",
    auth: "x-api-key",
    endpoints: [
      { method: "POST", host: "api.apollo.io", path: "/api/v1/mixed_people/search", class: "READ" },
      { method: "POST", host: "api.apollo.io", path: "/api/v1/people/match", class: "READ" },
    ],
  },
  "clay-enrichment": {
    skill: "clay-enrichment",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.clay.com", path: "/v1/tables", class: "READ" },
      { method: "POST", host: "api.clay.com", path: "/v1/enrichments", class: "READ" },
    ],
  },
  "instantly-email": {
    skill: "instantly-email",
    auth: "query-key",
    endpoints: [
      { method: "GET", host: "api.instantly.ai", path: "/api/v1/analytics", class: "READ" },
      { method: "POST", host: "api.instantly.ai", path: "/api/v1/campaign/create", class: "ACTION" },
      { method: "POST", host: "api.instantly.ai", path: "/api/v1/lead/add", class: "ACTION" },
    ],
  },
  "linkedin-api": {
    skill: "linkedin-api",
    auth: "composio",
    endpoints: [
      composioOp("LINKEDIN_GET_MY_INFO", "READ"),
      composioOp("LINKEDIN_GET_COMPANY_INFO", "READ"),
      composioOp("LINKEDIN_CREATE_LINKED_IN_POST", "ACTION"),
    ],
  },
  "youtube-data-api": {
    skill: "youtube-data-api",
    auth: "composio",
    endpoints: [
      composioOp("YOUTUBE_SEARCH_YOU_TUBE", "READ"),
      composioOp("YOUTUBE_GET_CHANNEL_STATISTICS", "READ"),
      composioOp("YOUTUBE_LIST_USER_PLAYLISTS", "READ"),
      composioOp("YOUTUBE_UPDATE_VIDEO", "ACTION"),
    ],
  },
  "beehiiv-api": {
    skill: "beehiiv-api",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.beehiiv.com", path: "/v2/publications", class: "READ" },
      { method: "POST", host: "api.beehiiv.com", path: "/v2/publications", class: "ACTION" },
    ],
  },
  "convertkit-newsletter": {
    skill: "convertkit-newsletter",
    auth: "composio",
    endpoints: [
      composioOp("KIT_LIST_SUBSCRIBERS", "READ"),
      composioOp("KIT_LIST_BROADCASTS", "READ"),
      composioOp("KIT_ADD_SUBSCRIBER_TO_FORM", "ACTION"),
    ],
  },
  "binance-trading": {
    skill: "binance-trading",
    auth: "binance-key",
    endpoints: [
      { method: "GET", host: "api.binance.com", path: "/api/v3/ticker/price", class: "READ" },
      { method: "GET", host: "api.binance.com", path: "/api/v3/account", class: "READ" },
      { method: "POST", host: "api.binance.com", path: "/api/v3/order", class: "ACTION" },
    ],
  },
  "coinbase-trading": {
    skill: "coinbase-trading",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.coinbase.com", path: "/v3/brokerage/accounts", class: "READ" },
      { method: "GET", host: "api.coinbase.com", path: "/v3/brokerage/products", class: "READ" },
      { method: "POST", host: "api.coinbase.com", path: "/v3/brokerage/orders", class: "ACTION" },
    ],
  },
  "polymarket-trading": {
    skill: "polymarket-trading",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "clob.polymarket.com", path: "/markets", class: "READ" },
      { method: "POST", host: "clob.polymarket.com", path: "/order", class: "ACTION" },
    ],
  },
  "linear-pm": {
    skill: "linear-pm",
    auth: "composio",
    endpoints: [
      composioOp("LINEAR_LIST_LINEAR_ISSUES", "READ"),
      composioOp("LINEAR_CREATE_LINEAR_ISSUE", "ACTION"),
      composioOp("LINEAR_UPDATE_ISSUE", "ACTION"),
    ],
  },
  "asana-pm": {
    skill: "asana-pm",
    auth: "composio",
    endpoints: [
      composioOp("ASANA_GET_MULTIPLE_TASKS", "READ"),
      composioOp("ASANA_CREATE_A_TASK", "ACTION"),
      composioOp("ASANA_CREATE_TASK_COMMENT", "ACTION"),
    ],
  },
  "clickup-pm": {
    skill: "clickup-pm",
    auth: "composio",
    endpoints: [
      composioOp("CLICKUP_GET_TASKS", "READ"),
      composioOp("CLICKUP_CREATE_TASK", "ACTION"),
      composioOp("CLICKUP_CREATE_TASK_COMMENT", "ACTION"),
    ],
  },
  "jira-pm": {
    skill: "jira-pm",
    auth: "composio",
    endpoints: [
      composioOp("JIRA_GET_ISSUE", "READ"),
      composioOp("JIRA_CREATE_ISSUE", "ACTION"),
      composioOp("JIRA_ADD_COMMENT", "ACTION"),
    ],
  },
  "slack-messaging": {
    skill: "slack-messaging",
    auth: "composio",
    endpoints: [
      composioOp("SLACK_LIST_ALL_CHANNELS", "READ"),
      composioOp("SLACK_CHAT_POST_MESSAGE", "ACTION"),
      composioOp("SLACK_SEND_MESSAGE", "ACTION"),
    ],
  },
  "notion-docs": {
    skill: "notion-docs",
    auth: "composio",
    endpoints: [
      composioOp("NOTION_SEARCH_NOTION_PAGE", "READ"),
      composioOp("NOTION_QUERY_DATABASE", "READ"),
      composioOp("NOTION_ADD_PAGE_CONTENT", "ACTION"),
    ],
  },
  "shopify-store": {
    skill: "shopify-store",
    auth: "shopify-admin",
    endpoints: [
      { method: "GET", host: "*.myshopify.com", path: "/admin/api", class: "READ" },
      { method: "POST", host: "*.myshopify.com", path: "/admin/api", class: "ACTION" },
      { method: "PUT", host: "*.myshopify.com", path: "/admin/api", class: "ACTION" },
      { method: "PATCH", host: "*.myshopify.com", path: "/admin/api", class: "ACTION" },
    ],
  },
  "google-search-console": {
    skill: "google-search-console",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "www.googleapis.com", path: "/webmasters/v3/sites", class: "READ" },
      { method: "POST", host: "www.googleapis.com", path: "/webmasters/v3/sites", class: "READ" },
      { method: "POST", host: "searchconsole.googleapis.com", path: "/v1/urlInspection/index:inspect", class: "READ" },
      { method: "PUT", host: "www.googleapis.com", path: "/webmasters/v3/sites", class: "ACTION" },
    ],
  },
  "google-analytics": {
    skill: "google-analytics",
    auth: "composio",
    endpoints: [
      composioOp("GOOGLE_ANALYTICS_LIST_ACCOUNTS", "READ"),
      composioOp("GOOGLE_ANALYTICS_GET_ACCOUNT", "READ"),
      composioOp("GOOGLE_ANALYTICS_LIST_AUDIENCES", "READ"),
    ],
  },
  "ahrefs-seo": {
    skill: "ahrefs-seo",
    auth: "bearer",
    endpoints: [
      { method: "GET", host: "api.ahrefs.com", path: "/v3/site-explorer/backlinks", class: "READ" },
      { method: "GET", host: "api.ahrefs.com", path: "/v3/keywords-explorer/overview", class: "READ" },
      { method: "GET", host: "api.ahrefs.com", path: "/v3/site-explorer/domain-rating", class: "READ" },
    ],
  },
  "calendly-scheduling": {
    skill: "calendly-scheduling",
    auth: "composio",
    endpoints: [
      composioOp("CALENDLY_LIST_USER_S_EVENT_TYPES", "READ"),
      composioOp("CALENDLY_GET_CURRENT_USER", "READ"),
      composioOp("CALENDLY_LIST_EVENTS", "READ"),
    ],
  },
  "twilio-sms": {
    skill: "twilio-sms",
    auth: "twilio-basic",
    endpoints: [
      { method: "GET", host: "api.twilio.com", path: "/2010-04-01/Accounts", class: "READ" },
      { method: "POST", host: "api.twilio.com", path: "/2010-04-01/Accounts", class: "ACTION" },
    ],
  },
  "gmail-ops": {
    skill: "gmail-ops",
    auth: "composio",
    endpoints: [
      composioOp("GMAIL_FETCH_EMAILS", "READ"),
      composioOp("GMAIL_SEND_EMAIL", "ACTION"),
      composioOp("GMAIL_ADD_LABEL_TO_EMAIL", "ACTION"),
    ],
  },
  "google-calendar": {
    skill: "google-calendar",
    auth: "composio",
    endpoints: [
      composioOp("GOOGLECALENDAR_EVENTS_LIST", "READ"),
      composioOp("GOOGLECALENDAR_CREATE_EVENT", "ACTION"),
      composioOp("GOOGLECALENDAR_QUICK_ADD", "ACTION"),
    ],
  },
  "github-ops": {
    skill: "github-ops",
    auth: "composio",
    endpoints: [
      composioOp("GITHUB_ISSUES_LIST_FOR_REPO", "READ"),
      composioOp("GITHUB_GET_A_REPOSITORY", "READ"),
      composioOp("GITHUB_ISSUES_CREATE", "ACTION"),
    ],
  },
  "twitter-oauth": {
    skill: "twitter-oauth",
    auth: "composio",
    endpoints: [
      composioOp("TWITTER_POST_LOOKUP_BY_POST_ID", "READ"),
      composioOp("TWITTER_CREATION_OF_A_POST", "ACTION"),
      composioOp("TWITTER_FOLLOW_USER", "ACTION"),
    ],
  },
}

export const SKILL_HTTP_CONTRACTS: Readonly<Record<string, HttpSkillContract>> = Object.fromEntries(
  Object.entries(SKILL_HTTP_CONTRACTS_RAW).map(([slug, contract]) => [slug, withComposioPrefix(contract)]),
) as Readonly<Record<string, HttpSkillContract>>

/** Catalog tool slug → TOOL_SPECIFIC skill that owns the http contract. */
export const HTTP_SKILL_BY_TOOL_SLUG: Readonly<Record<string, string>> = {
  tavily: "tavily-search",
  hubspot: "hubspot-crm",
  salesforce: "salesforce-crm",
  apollo: "apollo-search",
  clay: "clay-enrichment",
  instantly: "instantly-email",
  "twitter-api": "twitter-api",
  linkedin: "linkedin-api",
  youtube: "youtube-data-api",
  "beehiiv-api": "beehiiv-api",
  convertkit: "convertkit-newsletter",
  binance: "binance-trading",
  coinbase: "coinbase-trading",
  alpaca: "alpaca-trading",
  polymarket: "polymarket-trading",
  linear: "linear-pm",
  asana: "asana-pm",
  clickup: "clickup-pm",
  jira: "jira-pm",
  slack: "slack-messaging",
  notion: "notion-docs",
  shopify: "shopify-store",
  "google-search-console": "google-search-console",
  "google-analytics": "google-analytics",
  ahrefs: "ahrefs-seo",
  calendly: "calendly-scheduling",
  twilio: "twilio-sms",
  gmail: "gmail-ops",
  google_calendar: "google-calendar",
  github: "github-ops",
  twitter: "twitter-oauth",
}

export function httpContractForSkill(slug: string): HttpSkillContract | null {
  return SKILL_HTTP_CONTRACTS[slug] ?? null
}

export function httpSkillForToolSlug(toolSlug: string): string | null {
  return HTTP_SKILL_BY_TOOL_SLUG[toolSlug] ?? null
}
