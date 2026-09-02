import { SeedSkill } from "./types"

export const TOOL_SPECIFIC_SKILLS: SeedSkill[] = [
  {
    name: "Tavily Search",
    slug: "tavily-search",
    description: "Real-time web search via the Tavily API",
    skillMd: `## Authentication
Set \`$TAVILY_API_KEY\` to your Tavily API key.

## Key Endpoints

**Search:**
\`\`\`bash
curl -X POST https://api.tavily.com/search \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"'$TAVILY_API_KEY'","query":"latest AI news","max_results":5}'
\`\`\`

**Extract (content from URL):**
\`\`\`bash
curl -X POST https://api.tavily.com/extract \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"'$TAVILY_API_KEY'","urls":["https://example.com"]}'
\`\`\`

Use \`search_depth: "advanced"\` for deeper results. Default returns title, url, content, and score.

## Scout query patterns (Trend Scout and similar)

Tavily corroborates why an X topic is moving. It does not invent the trend. Run 1-3 queries on topics that already survived twitter-api search/recent.

Patterns:
1. Corroborate: \`<topic> announcement OR launch OR paper\` + today's date context. max_results 5.
2. Disambiguate: \`<handle or product> <noun>\` when the tweet is vague. Do not use this to expand into adjacent hype.
3. Skip-news: if search/recent already has a primary source link, extract that URL instead of a new search.

Do not:
- Query "AI agents trending" (noise).
- Use Tavily as a substitute when a Bearer-header curl to twitter-api returns 401 (tell the human the Bearer is dead; reconnect in Manage Tools).
- Treat web_fetch 401 on api.twitter.com as a dead token. web_fetch does not send Authorization. Retry with curl -H "Authorization: Bearer $TWITTER_API_KEY".
- Treat twitter-api 402 as "down". 402 is tier-not-entitled: run Tavily-only and tell the human X API returned 402 Payment Required - add credits/upgrade at developer.x.com; running Tavily-only until then. Reconnect is not a remedy.
- Pull more than 3 queries per heartbeat window.`,
    type: "TOOL_SPECIFIC",
    category: "SEARCH",
    icon: "🔎",
    compatibleTools: ["tavily"],
    requiresToolConnection: true,
    requiredToolCategory: "SEARCH",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "HubSpot CRM",
    slug: "hubspot-crm",
    description: "Manage contacts, deals, and companies in HubSpot via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create contact - \`HUBSPOT_CREATE_CONTACT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"email":"j@example.com","firstname":"Jane","lastname":"Doe","company":"Acme"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/HUBSPOT_CREATE_CONTACT", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"email":"j@example.com","firstname":"Jane","lastname":"Doe","company":"Acme"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List contacts - \`HUBSPOT_HUBSPOT_LIST_CONTACTS\` _(tool name per Composio SDK 2026-04-19)_:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/HUBSPOT_HUBSPOT_LIST_CONTACTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"limit":10}}'
# Response: { data: { results: [{ id, properties: {...} }] }, successful: true }
\`\`\`

**Create deal - \`HUBSPOT_CREATE_DEAL\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/HUBSPOT_CREATE_DEAL \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"dealname":"Q1 expansion","amount":50000,"pipeline":"default"}}'
# Response: { data: { id, properties: {...} }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect HubSpot" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CRM",
    icon: "🔗",
    compatibleTools: ["hubspot"],
    requiresToolConnection: true,
    requiredToolCategory: "CRM",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Salesforce CRM",
    slug: "salesforce-crm",
    description: "Manage leads, opportunities, and accounts in Salesforce via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create contact - \`SALESFORCE_CREATE_CONTACT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SALESFORCE_CREATE_CONTACT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"FirstName":"Jane","LastName":"Doe","Email":"j@example.com","AccountId":"001..."}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/SALESFORCE_CREATE_CONTACT", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"FirstName":"Jane","LastName":"Doe","Email":"j@example.com","AccountId":"001..."},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List contacts - \`SALESFORCE_LIST_CONTACTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SALESFORCE_LIST_CONTACTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"limit":25}}'
# Response: { data: { records: [{ Id, Name, Email, ... }] }, successful: true }
\`\`\`

**Send email - \`SALESFORCE_SEND_EMAIL\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SALESFORCE_SEND_EMAIL \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"to":["j@example.com"],"subject":"Follow-up","body":"Circling back on our call..."}}'
# Response: { data: { sent: true, id: "..." }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Salesforce" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CRM",
    icon: "☁️",
    compatibleTools: ["salesforce"],
    requiresToolConnection: true,
    requiredToolCategory: "CRM",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Apollo Search",
    slug: "apollo-search",
    description: "B2B people search and contact enrichment via Apollo.io",
    skillMd: `## Authentication
Set \`$APOLLO_API_KEY\` to your Apollo API key.

## Key Endpoints

**People Search:**
\`\`\`bash
curl -X POST https://api.apollo.io/api/v1/mixed_people/search \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $APOLLO_API_KEY" \\
  -d '{"person_titles":["CTO"],"person_locations":["San Francisco"],"per_page":10}'
\`\`\`

**Enrich Person:**
\`\`\`bash
curl -X POST https://api.apollo.io/api/v1/people/match \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $APOLLO_API_KEY" \\
  -d '{"email":"jane@example.com"}'
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "LEAD_DATABASE",
    icon: "🚀",
    compatibleTools: ["apollo"],
    requiresToolConnection: true,
    requiredToolCategory: "LEAD_DATABASE",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Clay Enrichment",
    slug: "clay-enrichment",
    description: "Multi-source data enrichment via Clay API",
    skillMd: `## Authentication
Set \`$CLAY_API_KEY\` to your Clay API key.

## Key Endpoints

**Enrich Person:**
\`\`\`bash
curl -X POST https://api.clay.com/v1/enrichments \\
  -H "Authorization: Bearer $CLAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"jane@example.com","sources":["clearbit","apollo","hunter"]}'
\`\`\`

**List Tables:**
\`\`\`bash
curl https://api.clay.com/v1/tables \\
  -H "Authorization: Bearer $CLAY_API_KEY"
\`\`\`

Clay aggregates 50+ data providers. Specify sources or let Clay auto-select the best match.`,
    type: "TOOL_SPECIFIC",
    category: "ENRICHMENT",
    icon: "🧱",
    compatibleTools: ["clay"],
    requiresToolConnection: true,
    requiredToolCategory: "ENRICHMENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Instantly Email",
    slug: "instantly-email",
    description: "Send cold email campaigns via Instantly",
    skillMd: `## Authentication
Set \`$INSTANTLY_API_KEY\` to your Instantly API key.

## Key Endpoints

**Create Campaign:**
\`\`\`bash
curl -X POST https://api.instantly.ai/api/v1/campaign/create \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"'$INSTANTLY_API_KEY'","name":"Outbound Q1"}'
\`\`\`

**Add Leads to Campaign:**
\`\`\`bash
curl -X POST https://api.instantly.ai/api/v1/lead/add \\
  -H "Content-Type: application/json" \\
  -d '{"api_key":"'$INSTANTLY_API_KEY'","campaign_id":"abc","leads":[{"email":"j@co.com","first_name":"Jane"}]}'
\`\`\`

**Get Campaign Analytics:**
\`\`\`bash
curl "https://api.instantly.ai/api/v1/analytics/campaign/summary?api_key=$INSTANTLY_API_KEY&campaign_id=abc"
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "EMAIL_SENDER",
    icon: "⚡",
    compatibleTools: ["instantly"],
    requiresToolConnection: true,
    requiredToolCategory: "EMAIL_SENDER",
    isBuiltIn: false,
    permissions: ["internet_access", "email_send"],
  },
  {
    name: "Twitter API",
    slug: "twitter-api",
    description: "Read and search tweets via the Twitter/X API (Bearer; drafts only, human posts)",
    skillMd: `## Authentication
Set \`$TWITTER_API_KEY\` to the Twitter/X Bearer token (app-only). This toolkit is read-focused. The claw drafts; the human posts. Do not treat Bearer as a user-OAuth posting key.

## Endpoints used per mission

**Morning / first-mission (Trend Scout):** \`GET /2/tweets/search/recent\`
Query = USER.md niche terms, recency 6h, max_results 10-20. Fields: author_id, created_at, public_metrics, text.

\`\`\`bash
curl "https://api.twitter.com/2/tweets/search/recent?query=evals%20agents&max_results=10&tweet.fields=created_at,public_metrics" \\
  -H "Authorization: Bearer $TWITTER_API_KEY"
\`\`\`

**Content cycle (Engagement):** \`GET /2/tweets/:id\` for a candidate reply target. Confirm text and metrics before writing a line.

**Evening recap (Analytics):** \`GET /2/users/:id/tweets\` for today's posts only (max_results 10) + lookup for any known ids.

\`\`\`bash
curl "https://api.twitter.com/2/users/{id}/tweets?max_results=10&tweet.fields=created_at,public_metrics" \\
  -H "Authorization: Bearer $TWITTER_API_KEY"
\`\`\`

## Rate-limit behavior

Call these endpoints with \`curl\` and \`-H "Authorization: Bearer $TWITTER_API_KEY"\`. Never \`web_fetch\` api.twitter.com or api.x.com (no Authorization header; those hosts then 401 even when the Bearer is live). Never GET /2/users/me (app-only forbidden, 403 Unsupported Authentication; not a dead token).

- 429: wait for reset (or 60s if unknown), one retry, then DEGRADED. Do not tight-loop.
- 401 after a Bearer curl: token is dead. Stop. Tell the human to reconnect in Manage Tools. Do not invent a timeline. Do not degrade to Tavily.
- web_fetch 401 on api.twitter.com: missing Authorization, not token-dead. Retry with curl. Reconnect is not the remedy.
- 403 Unsupported Authentication on /2/users/me: wrong endpoint for app-only Bearer. Do not reconnect.
- 402: X API returned 402 Payment Required - add credits/upgrade at developer.x.com; running Tavily-only until then. Reconnect is not a remedy.
- 5xx: one retry. Then DEGRADED.

## What NOT to fetch

- Full-archive / all-time search
- DMs, email, phone
- Follower dumps or block lists
- POST /2/tweets (this claw does not post on Bearer)
- GET /2/users/me
- User lookup sprees outside the mission

## What not to do with the data

Do not fabricate public_metrics when the field is missing. Write unknown. Do not paginate "just in case" past the recency window.`,
    type: "TOOL_SPECIFIC",
    category: "SOCIAL",
    icon: "🐦",
    compatibleTools: ["twitter-api"],
    requiresToolConnection: true,
    requiredToolCategory: "SOCIAL",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "LinkedIn API",
    slug: "linkedin-api",
    description: "Post to LinkedIn and read profile info via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> LinkedIn's Composio surface is narrow (4 tools total). For analytics or ad operations, integrate LinkedIn's Marketing API directly via an API-key connection.


## Key operations

**Create post - \`LINKEDIN_CREATE_LINKED_IN_POST\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINKEDIN_CREATE_LINKED_IN_POST \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"text":"Shipping the future of agent teams.","visibility":"PUBLIC"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/LINKEDIN_CREATE_LINKED_IN_POST", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"text":"Shipping the future of agent teams.","visibility":"PUBLIC"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Get my profile - \`LINKEDIN_GET_MY_INFO\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINKEDIN_GET_MY_INFO \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{}}'
# Response: { data: { id, localizedFirstName, localizedLastName, ... }, successful: true }
\`\`\`

**Get company info - \`LINKEDIN_GET_COMPANY_INFO\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINKEDIN_GET_COMPANY_INFO \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"organizationId":"1234567"}}'
# Response: { data: { id, name, description, ... }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect LinkedIn" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "SOCIAL",
    icon: "💼",
    compatibleTools: ["linkedin"],
    requiresToolConnection: true,
    requiredToolCategory: "SOCIAL",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  // `buffer-social` skill removed in PR #4 - Composio has no `buffer` toolkit,
  // so this skill had no usable tool to bind to. Restoration tracked in the
  // "Template seed data drift" umbrella issue; remediation path is PR #6's
  // Custom API pipeline (buffer-api direct-token).
  {
    name: "YouTube Data API",
    slug: "youtube-data-api",
    description: "Search videos, read channel stats, and list playlists via Composio YouTube OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> Bind this skill to the OAuth \`youtube\` catalog tool (not the deprecated API_KEY \`youtube-data-api\` slug). Writes and channel-owner reads require the connected Google account.

## Key operations

**Search videos - \`YOUTUBE_SEARCH_YOU_TUBE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/YOUTUBE_SEARCH_YOU_TUBE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"q":"AI agents","type":"video","maxResults":10}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/YOUTUBE_SEARCH_YOU_TUBE", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"q":"AI agents","type":"video","maxResults":10},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Channel statistics - \`YOUTUBE_GET_CHANNEL_STATISTICS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/YOUTUBE_GET_CHANNEL_STATISTICS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{}}'
# Response: { data: { statistics: { viewCount, subscriberCount, videoCount } }, successful: true }
\`\`\`

**List playlists - \`YOUTUBE_LIST_USER_PLAYLISTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/YOUTUBE_LIST_USER_PLAYLISTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{}}'
# Response: { data: { items: [{ id, snippet: { title } }] }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect YouTube" to the human.
- **Quota** - YouTube Data API quota exhausted; backoff and report remaining quota if present.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "🎬",
    compatibleTools: ["youtube"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  // `beehiiv-newsletter` and `substack-newsletter` skills removed in PR #4 -
  // Composio has no `beehiiv` or `substack` toolkit. Beehiiv users can instead
  // use `beehiiv-api` (API_KEY_TOOLS, direct-token) via the MarketplaceSkill
  // `beehiiv-newsletter` row in marketplace-skills.ts. Substack has no current
  // remediation path; tracked in the umbrella drift issue.
  {
    name: "ConvertKit Newsletter",
    slug: "convertkit-newsletter",
    description: "Manage subscribers and broadcasts via ConvertKit (Kit) Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> ConvertKit rebranded to "Kit" in 2024; Composio's toolkit slug is \`kit\`. Catalog slug stays \`convertkit\` for user-facing continuity.


## Key operations

**Add subscriber to form - \`KIT_ADD_SUBSCRIBER_TO_FORM\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/KIT_ADD_SUBSCRIBER_TO_FORM \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"form_id":12345,"email":"subscriber@example.com","first_name":"Jane"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/KIT_ADD_SUBSCRIBER_TO_FORM", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"form_id":12345,"email":"subscriber@example.com","first_name":"Jane"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List subscribers - \`KIT_LIST_SUBSCRIBERS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/KIT_LIST_SUBSCRIBERS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"per_page":50}}'
# Response: { data: { subscribers: [{ id, email_address, state, created_at }] }, successful: true }
\`\`\`

**List broadcasts - \`KIT_LIST_BROADCASTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/KIT_LIST_BROADCASTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"per_page":10}}'
# Response: { data: { broadcasts: [{ id, subject, published_at, ... }] }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect ConvertKit (Kit)" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "💌",
    compatibleTools: ["convertkit"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Binance Trading",
    slug: "binance-trading",
    description: "Crypto prices, balances, and orders via Binance API",
    skillMd: `## Authentication
Set \`$BINANCE_API_KEY\` and \`$BINANCE_API_SECRET\` for signed endpoints.

## Key Endpoints

**Get Price:**
\`\`\`bash
curl "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
\`\`\`

**Place Order (signed):**
\`\`\`bash
curl -X POST "https://api.binance.com/api/v3/order" \\
  -H "X-MBX-APIKEY: $BINANCE_API_KEY" \\
  -d "symbol=BTCUSDT&side=BUY&type=LIMIT&timeInForce=GTC&quantity=0.001&price=50000&timestamp=$(date +%s000)&signature=COMPUTED_HMAC"
\`\`\`

**Account Balance:**
\`\`\`bash
curl "https://api.binance.com/api/v3/account?timestamp=$(date +%s000)&signature=COMPUTED_HMAC" \\
  -H "X-MBX-APIKEY: $BINANCE_API_KEY"
\`\`\`

Signatures require HMAC-SHA256 of the query string using \`$BINANCE_API_SECRET\`.`,
    type: "TOOL_SPECIFIC",
    category: "TRADING",
    icon: "₿",
    compatibleTools: ["binance"],
    requiresToolConnection: true,
    requiredToolCategory: "TRADING",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Coinbase Trading",
    slug: "coinbase-trading",
    description: "Crypto trading via Coinbase Advanced Trade API",
    skillMd: `## Authentication
Set \`$COINBASE_API_KEY\`, \`$COINBASE_API_SECRET\`, and \`$COINBASE_API_PASSPHRASE\` for Coinbase Exchange (the Advanced Trade endpoint uses the same Exchange HMAC auth per docs.cloud.coinbase.com/exchange/docs/rest-auth).

## Key Endpoints

**List Accounts:**
\`\`\`bash
curl "https://api.coinbase.com/api/v3/brokerage/accounts" \\
  -H "Authorization: Bearer $COINBASE_API_KEY"
\`\`\`

**Get Product Candles:**
\`\`\`bash
curl "https://api.coinbase.com/api/v3/brokerage/products/BTC-USD/candles?granularity=ONE_HOUR" \\
  -H "Authorization: Bearer $COINBASE_API_KEY"
\`\`\`

**Create Order:**
\`\`\`bash
curl -X POST "https://api.coinbase.com/api/v3/brokerage/orders" \\
  -H "Authorization: Bearer $COINBASE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"product_id":"BTC-USD","side":"BUY","order_configuration":{"limit_limit_gtc":{"base_size":"0.001","limit_price":"50000"}}}'
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "TRADING",
    icon: "🪙",
    compatibleTools: ["coinbase"],
    requiresToolConnection: true,
    requiredToolCategory: "TRADING",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Alpaca Trading",
    slug: "alpaca-trading",
    description: "US stock trading via Alpaca Markets API",
    skillMd: `## Authentication
Set \`$ALPACA_API_KEY_ID\` and \`$ALPACA_API_SECRET_KEY\` for Alpaca.

## Key Endpoints

**Get Account:**
\`\`\`bash
curl https://paper-api.alpaca.markets/v2/account \\
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY_ID" \\
  -H "APCA-API-SECRET-KEY: $ALPACA_API_SECRET_KEY"
\`\`\`

**Place Order:**
\`\`\`bash
curl -X POST https://paper-api.alpaca.markets/v2/orders \\
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY_ID" \\
  -H "APCA-API-SECRET-KEY: $ALPACA_API_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","qty":"1","side":"buy","type":"market","time_in_force":"day"}'
\`\`\`

**Get Positions:**
\`\`\`bash
curl https://paper-api.alpaca.markets/v2/positions \\
  -H "APCA-API-KEY-ID: $ALPACA_API_KEY_ID" \\
  -H "APCA-API-SECRET-KEY: $ALPACA_API_SECRET_KEY"
\`\`\`

Use \`paper-api\` for paper trading, \`api\` for live.`,
    type: "TOOL_SPECIFIC",
    category: "TRADING",
    icon: "📈",
    compatibleTools: ["alpaca"],
    requiresToolConnection: true,
    requiredToolCategory: "TRADING",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Polymarket Trading",
    slug: "polymarket-trading",
    description: "Trade on prediction markets via Polymarket",
    skillMd: `## Authentication
Set \`$POLYMARKET_API_KEY\` to your Polymarket API key.

## Key Endpoints

**List Markets:**
\`\`\`bash
curl "https://clob.polymarket.com/markets?limit=10"
\`\`\`

**Get Market Details:**
\`\`\`bash
curl "https://clob.polymarket.com/markets/{condition_id}"
\`\`\`

**Place Order:**
\`\`\`bash
curl -X POST "https://clob.polymarket.com/order" \\
  -H "Authorization: Bearer $POLYMARKET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tokenID":"abc","price":0.65,"size":10,"side":"BUY"}'
\`\`\`

Polymarket uses a CLOB (Central Limit Order Book). Prices are between 0 and 1, representing probability.`,
    type: "TOOL_SPECIFIC",
    category: "TRADING",
    icon: "🎯",
    compatibleTools: ["polymarket"],
    requiresToolConnection: true,
    requiredToolCategory: "TRADING",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Linear PM",
    slug: "linear-pm",
    description: "Manage issues, projects, and teams via Linear Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create issue - \`LINEAR_CREATE_LINEAR_ISSUE\` _(tool name per Composio SDK 2026-04-19)_:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINEAR_CREATE_LINEAR_ISSUE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"title":"Fix rate-limit handling in GatewayProxy","teamId":"<team-id>","priority":2,"description":"Seeing 429s on heartbeat calls."}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/LINEAR_CREATE_LINEAR_ISSUE", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"title":"Fix rate-limit handling in GatewayProxy","teamId":"<team-id>","priority":2,"description":"Seeing 429s on heartbeat calls."},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List issues - \`LINEAR_LIST_LINEAR_ISSUES\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINEAR_LIST_LINEAR_ISSUES \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"first":25,"filter":{"state":{"type":{"eq":"unstarted"}}}}}'
# Response: { data: { nodes: [{ id, identifier, title, state: { name }, ... }] }, successful: true }
\`\`\`

**Update issue - \`LINEAR_UPDATE_ISSUE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/LINEAR_UPDATE_ISSUE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"id":"<issue-id>","stateId":"<done-state-id>","priority":1}}'
# Response: { data: { issueUpdate: { success: true, issue: { id, identifier, state } } }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Linear" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "PROJECT_MGMT",
    icon: "📐",
    compatibleTools: ["linear"],
    requiresToolConnection: true,
    requiredToolCategory: "PROJECT_MGMT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Asana PM",
    slug: "asana-pm",
    description: "Manage tasks, projects, and teams via Asana Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create task - \`ASANA_CREATE_A_TASK\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/ASANA_CREATE_A_TASK \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"name":"Review quarterly metrics","workspace":"12345","assignee":"me","due_on":"2026-05-01"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/ASANA_CREATE_A_TASK", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"name":"Review quarterly metrics","workspace":"12345","assignee":"me","due_on":"2026-05-01"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List tasks - \`ASANA_GET_MULTIPLE_TASKS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/ASANA_GET_MULTIPLE_TASKS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"project":"<project-gid>","completed_since":"now","limit":25}}'
# Response: { data: { data: [{ gid, name, completed, assignee: { gid, name } }] }, successful: true }
\`\`\`

**Comment on task - \`ASANA_CREATE_TASK_COMMENT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/ASANA_CREATE_TASK_COMMENT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"task":"<task-gid>","text":"Bumping this - need it by EOW."}}'
# Response: { data: { data: { gid, text, created_at } }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Asana" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "PROJECT_MGMT",
    icon: "🎯",
    compatibleTools: ["asana"],
    requiresToolConnection: true,
    requiredToolCategory: "PROJECT_MGMT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "ClickUp PM",
    slug: "clickup-pm",
    description: "Manage tasks and comments in ClickUp via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create task - \`CLICKUP_CREATE_TASK\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CLICKUP_CREATE_TASK \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"list_id":"<list-id>","name":"Draft Q2 OKRs","priority":2,"due_date":1714521600000}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/CLICKUP_CREATE_TASK", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"list_id":"<list-id>","name":"Draft Q2 OKRs","priority":2,"due_date":1714521600000},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List tasks in list - \`CLICKUP_GET_TASKS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CLICKUP_GET_TASKS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"list_id":"<list-id>","archived":false,"page":0}}'
# Response: { data: { tasks: [{ id, name, status: { status }, assignees: [...] }] }, successful: true }
\`\`\`

**Comment on task - \`CLICKUP_CREATE_TASK_COMMENT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CLICKUP_CREATE_TASK_COMMENT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"task_id":"<task-id>","comment_text":"Blocker: waiting on design review."}}'
# Response: { data: { id, comment_text, user: { id, username } }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect ClickUp" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "PROJECT_MGMT",
    icon: "✅",
    compatibleTools: ["clickup"],
    requiresToolConnection: true,
    requiredToolCategory: "PROJECT_MGMT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Jira PM",
    slug: "jira-pm",
    description: "Manage issues and comments in Jira via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create issue - \`JIRA_CREATE_ISSUE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/JIRA_CREATE_ISSUE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"project":"ENG","summary":"Page render regression on /dashboard","issuetype":"Bug","priority":"High"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/JIRA_CREATE_ISSUE", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"project":"ENG","summary":"Page render regression on /dashboard","issuetype":"Bug","priority":"High"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Get issue - \`JIRA_GET_ISSUE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/JIRA_GET_ISSUE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"issueKey":"ENG-1234"}}'
# Response: { data: { id, key, fields: { summary, status: { name }, assignee: { displayName } } }, successful: true }
\`\`\`

**Comment on issue - \`JIRA_ADD_COMMENT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/JIRA_ADD_COMMENT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"issueKey":"ENG-1234","body":"Reproducing locally - update in next standup."}}'
# Response: { data: { id, body, author: { displayName }, created }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Jira" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "PROJECT_MGMT",
    icon: "🔵",
    compatibleTools: ["jira"],
    requiresToolConnection: true,
    requiredToolCategory: "PROJECT_MGMT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Slack Messaging",
    slug: "slack-messaging",
    description: "Post messages and list channels in Slack via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Post message to channel - \`SLACK_CHAT_POST_MESSAGE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SLACK_CHAT_POST_MESSAGE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"channel":"C01234567","text":"Deploy complete: v2.3.1 is live.","unfurl_links":false}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/SLACK_CHAT_POST_MESSAGE", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"channel":"C01234567","text":"Deploy complete: v2.3.1 is live.","unfurl_links":false},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List channels - \`SLACK_LIST_ALL_CHANNELS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SLACK_LIST_ALL_CHANNELS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"exclude_archived":true,"types":"public_channel,private_channel"}}'
# Response: { data: { channels: [{ id, name, is_member, num_members }] }, successful: true }
\`\`\`

**Send message (alt form) - \`SLACK_SEND_MESSAGE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SLACK_SEND_MESSAGE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"receiver":"@username","message":"Heads up: the daily report surfaced 3 new anomalies."}}'
# Response: { data: { ok: true, ts, channel }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Slack" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "COMMUNICATION",
    icon: "💬",
    compatibleTools: ["slack"],
    requiresToolConnection: true,
    requiredToolCategory: "COMMUNICATION",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Notion Docs",
    slug: "notion-docs",
    description: "Manage pages and databases in Notion via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Append content to page - \`NOTION_ADD_PAGE_CONTENT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/NOTION_ADD_PAGE_CONTENT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"page_id":"<page-id>","content":"## Follow-ups\n- [ ] Circle back with Finance\n- [ ] Book design review"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/NOTION_ADD_PAGE_CONTENT", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"page_id":"<page-id>","content":"## Follow-ups\n- [ ] Circle back with Finance\n- [ ] Book design review"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Search pages - \`NOTION_SEARCH_NOTION_PAGE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/NOTION_SEARCH_NOTION_PAGE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"query":"Q1 review","page_size":10}}'
# Response: { data: { results: [{ id, url, properties: { title: [...] } }] }, successful: true }
\`\`\`

**Query database - \`NOTION_QUERY_DATABASE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/NOTION_QUERY_DATABASE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"database_id":"<db-id>","filter":{"property":"Status","select":{"equals":"In progress"}}}}'
# Response: { data: { results: [{ id, properties: {...} }], has_more, next_cursor }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Notion" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "📝",
    compatibleTools: ["notion"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Shopify Store",
    slug: "shopify-store",
    description: "Manage orders and products in Shopify via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create order - \`SHOPIFY_CREATE_ORDER\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SHOPIFY_CREATE_ORDER \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"line_items":[{"variant_id":12345,"quantity":2}],"customer":{"email":"buyer@example.com"},"financial_status":"pending"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/SHOPIFY_CREATE_ORDER", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"line_items":[{"variant_id":12345,"quantity":2}],"customer":{"email":"buyer@example.com"},"financial_status":"pending"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List products - \`SHOPIFY_GET_PRODUCTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SHOPIFY_GET_PRODUCTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"limit":25,"status":"active"}}'
# Response: { data: { products: [{ id, title, vendor, variants: [...] }] }, successful: true }
\`\`\`

**Create product - \`SHOPIFY_CREATE_PRODUCT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/SHOPIFY_CREATE_PRODUCT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"title":"Alpha Tee","body_html":"<p>Limited drop.</p>","vendor":"LaxClaws","variants":[{"price":"25.00","option1":"Default"}]}}'
# Response: { data: { product: { id, title, handle, variants } }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Shopify" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "FINANCE",
    icon: "🛍️",
    compatibleTools: ["shopify"],
    requiresToolConnection: true,
    requiredToolCategory: "FINANCE",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Google Search Console",
    slug: "google-search-console",
    description: "Search performance and indexing data via Composio",
    skillMd: `## Authentication
Via Composio OAuth - auth managed automatically.

## Capabilities
- Query search analytics (clicks, impressions, CTR, position)
- Inspect URL indexing status
- Submit sitemaps
- View crawl errors and coverage reports

Composio handles the full OAuth2 flow. No manual token management required.`,
    type: "TOOL_SPECIFIC",
    category: "ANALYTICS",
    icon: "📊",
    compatibleTools: ["google-search-console"],
    requiresToolConnection: true,
    requiredToolCategory: "ANALYTICS",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Google Analytics",
    slug: "google-analytics",
    description: "Read GA4 account metadata via Composio OAuth (read-only surface)",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> Google Analytics via Composio is read-only; metric queries require the Google Analytics Data API directly (not yet exposed via Composio).


## Key operations

**List accounts - \`GOOGLE_ANALYTICS_LIST_ACCOUNTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLE_ANALYTICS_LIST_ACCOUNTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/GOOGLE_ANALYTICS_LIST_ACCOUNTS", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Get account - \`GOOGLE_ANALYTICS_GET_ACCOUNT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLE_ANALYTICS_GET_ACCOUNT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"name":"accounts/<account-id>"}}'
# Response: { data: { name, displayName, regionCode }, successful: true }
\`\`\`

**List audiences - \`GOOGLE_ANALYTICS_LIST_AUDIENCES\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLE_ANALYTICS_LIST_AUDIENCES \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"parent":"properties/<property-id>"}}'
# Response: { data: { audiences: [{ name, displayName, description }] }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Google Analytics" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "ANALYTICS",
    icon: "📈",
    compatibleTools: ["google-analytics"],
    requiresToolConnection: true,
    requiredToolCategory: "ANALYTICS",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Ahrefs SEO",
    slug: "ahrefs-seo",
    description: "Keyword research and backlink analysis via Ahrefs API",
    skillMd: `## Authentication
Set \`$AHREFS_API_KEY\` to your Ahrefs API token.

## Key Endpoints

**Get Backlinks:**
\`\`\`bash
curl "https://api.ahrefs.com/v3/site-explorer/backlinks?target=example.com&limit=10" \\
  -H "Authorization: Bearer $AHREFS_API_KEY"
\`\`\`

**Keywords Explorer:**
\`\`\`bash
curl "https://api.ahrefs.com/v3/keywords-explorer/overview?keywords=ai+agents&country=us" \\
  -H "Authorization: Bearer $AHREFS_API_KEY"
\`\`\`

**Domain Rating:**
\`\`\`bash
curl "https://api.ahrefs.com/v3/site-explorer/domain-rating?target=example.com" \\
  -H "Authorization: Bearer $AHREFS_API_KEY"
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "ANALYTICS",
    icon: "🔗",
    compatibleTools: ["ahrefs"],
    requiresToolConnection: true,
    requiredToolCategory: "ANALYTICS",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Calendly Scheduling",
    slug: "calendly-scheduling",
    description: "Read event types and scheduled events via Calendly Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> Calendly events are created by external users via public booking pages - not via API. These ops are for reading/managing existing bookings.


## Key operations

**List event types - \`CALENDLY_LIST_USER_S_EVENT_TYPES\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CALENDLY_LIST_USER_S_EVENT_TYPES \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"user":"https://api.calendly.com/users/<user-uuid>"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/CALENDLY_LIST_USER_S_EVENT_TYPES", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"user":"https://api.calendly.com/users/<user-uuid>"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Get current user - \`CALENDLY_GET_CURRENT_USER\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CALENDLY_GET_CURRENT_USER \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{}}'
# Response: { data: { resource: { uri, name, email, scheduling_url } }, successful: true }
\`\`\`

**List scheduled events - \`CALENDLY_LIST_EVENTS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/CALENDLY_LIST_EVENTS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"user":"https://api.calendly.com/users/<user-uuid>","status":"active"}}'
# Response: { data: { collection: [{ uri, name, start_time, end_time, invitees_counter }] }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Calendly" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CALENDAR",
    icon: "📅",
    compatibleTools: ["calendly"],
    requiresToolConnection: true,
    requiredToolCategory: "CALENDAR",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Twilio SMS",
    slug: "twilio-sms",
    description: "Send and receive SMS messages via Twilio",
    skillMd: `## Authentication
Set \`$TWILIO_ACCOUNT_SID\` and \`$TWILIO_AUTH_TOKEN\`. The SID identifies the Twilio account; both are supplied together as HTTP Basic Auth (\`sid:token\`) for every REST call.

## Key Endpoints

**Send SMS:**
\`\`\`bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \\
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \\
  -d "To=+1234567890&From=+0987654321&Body=Hello from LaxClaws!"
\`\`\`

**List Messages:**
\`\`\`bash
curl "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json?PageSize=10" \\
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
\`\`\`

Uses Basic auth with Account SID and Auth Token.`,
    type: "TOOL_SPECIFIC",
    category: "COMMUNICATION",
    icon: "📱",
    compatibleTools: ["twilio"],
    requiresToolConnection: true,
    requiredToolCategory: "COMMUNICATION",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  // `wordpress-cms` skill removed in PR #4 - Composio has no `wordpress`
  // toolkit. WordPress users can still install the `wordpress-cms`
  // MarketplaceSkill (marketplace-skills.ts) which uses a direct
  // WORDPRESS_URL + WORDPRESS_TOKEN pair (no OAuth). Restoration as a
  // built-in skill tracked in the umbrella drift issue; built-in
  // restoration needs PR #6's Custom API pipeline (wordpress-api).
  // ─── PR #4 Commit 5: new OAuth skills ──────────────────────────────────
  // Added because OAUTH_TOOLS catalog entries (gmail, google_calendar,
  // github, twitter) previously had no matching Skill row, so the
  // generator's compatibleTools lookup couldn't resolve them. All four
  // share the canonical Composio emission shape from the 13 existing
  // OAuth skills above.

  {
    name: "Gmail Operations",
    slug: "gmail-ops",
    description: "Send, fetch, and label Gmail messages via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Send email - \`GMAIL_SEND_EMAIL\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"recipient_email":"j@example.com","subject":"Follow-up","body":"Circling back on our conversation.","is_html":false}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"recipient_email":"j@example.com","subject":"Follow-up","body":"Circling back on our conversation.","is_html":false},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Fetch recent emails - \`GMAIL_FETCH_EMAILS\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"max_results":10,"query":"is:unread newer_than:1d"}}'
# Response: { data: { messages: [{ messageId, threadId, payload: { headers, parts } }] }, successful: true }
\`\`\`

**Add label - \`GMAIL_ADD_LABEL_TO_EMAIL\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_ADD_LABEL_TO_EMAIL \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"message_id":"<msg-id>","add_label_ids":["Label_1234567890"]}}'
# Response: { data: { id, labelIds, threadId }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Gmail" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "EMAIL_SENDER",
    icon: "📧",
    compatibleTools: ["gmail"],
    requiresToolConnection: true,
    requiredToolCategory: "EMAIL_SENDER",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Google Calendar",
    slug: "google-calendar",
    description: "Create and list Google Calendar events via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create event - \`GOOGLECALENDAR_CREATE_EVENT\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLECALENDAR_CREATE_EVENT \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"summary":"Team sync","start_datetime":"2026-05-01T10:00:00","event_duration_hour":1,"attendees":["j@example.com"],"calendar_id":"primary"}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/GOOGLECALENDAR_CREATE_EVENT", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"summary":"Team sync","start_datetime":"2026-05-01T10:00:00","event_duration_hour":1,"attendees":["j@example.com"],"calendar_id":"primary"},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List upcoming events - \`GOOGLECALENDAR_EVENTS_LIST\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLECALENDAR_EVENTS_LIST \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"calendar_id":"primary","max_results":10,"time_min":"2026-05-01T00:00:00Z","single_events":true,"order_by":"startTime"}}'
# Response: { data: { items: [{ id, summary, start: { dateTime }, end: { dateTime }, attendees: [...] }] }, successful: true }
\`\`\`

**Quick-add via natural language - \`GOOGLECALENDAR_QUICK_ADD\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GOOGLECALENDAR_QUICK_ADD \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"calendar_id":"primary","text":"Lunch with Sarah tomorrow 1pm"}}'
# Response: { data: { id, summary, start, end, htmlLink }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Google Calendar" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CALENDAR",
    icon: "🗓️",
    compatibleTools: ["google_calendar"],
    requiresToolConnection: true,
    requiredToolCategory: "CALENDAR",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "GitHub Operations",
    slug: "github-ops",
    description: "Open issues, list issues, and inspect repositories via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

## Key operations

**Create issue - \`GITHUB_ISSUES_CREATE\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GITHUB_ISSUES_CREATE \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"owner":"laxcorp-research","repo":"claws","title":"Investigate flaky E2E on setup-wizard","body":"Seeing intermittent failures on main","labels":["bug","e2e"]}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/GITHUB_ISSUES_CREATE", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"owner":"laxcorp-research","repo":"claws","title":"Investigate flaky E2E on setup-wizard","body":"Seeing intermittent failures on main","labels":["bug","e2e"]},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**List issues for repo - \`GITHUB_ISSUES_LIST_FOR_REPO\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GITHUB_ISSUES_LIST_FOR_REPO \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"owner":"laxcorp-research","repo":"claws","state":"open","per_page":25,"labels":"bug"}}'
# Response: { data: [{ number, title, state, labels: [...], user: { login } }], successful: true }
\`\`\`

**Get repository metadata - \`GITHUB_GET_A_REPOSITORY\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/GITHUB_GET_A_REPOSITORY \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"owner":"laxcorp-research","repo":"claws"}}'
# Response: { data: { id, name, full_name, description, default_branch, open_issues_count }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect GitHub" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "🐙",
    compatibleTools: ["github"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Twitter/X OAuth",
    slug: "twitter-oauth",
    description: "Post, look up, and follow on Twitter/X via Composio OAuth",
    skillMd: `## Authentication

This skill calls Composio's REST endpoint at runtime using three env vars the Claws runtime injects (never stored in this container):
- \`$COMPOSIO_API_KEY\` - platform secret
- \`$COMPOSIO_USER_ID\` - \`claws_<user_id>\`, scopes every call to this workspace's user
- \`$COMPOSIO_CONNECTED_ACCOUNT_ID\` - the OAuth connection for this toolkit

No OAuth tokens enter the container. Composio handles refresh/rotation/revocation server-side.

> Twitter's OAuth toolkit is distinct from the \`twitter-api\` API_KEY toolkit (Bearer-token, read-focused). Use this seed for write operations (posting, following) that require user-scoped OAuth.


## Key operations

**Create post - \`TWITTER_CREATION_OF_A_POST\` _(tool name per Composio SDK 2026-04-19)_:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/TWITTER_CREATION_OF_A_POST \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"text":"New drop: agent teams that ship themselves."}}'
\`\`\`

Or via Node (OpenClaw's skill runtime has \`fetch()\` natively):

\`\`\`javascript
const r = await fetch("https://backend.composio.dev/api/v3/tools/execute/TWITTER_CREATION_OF_A_POST", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.COMPOSIO_API_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    user_id: process.env.COMPOSIO_USER_ID,
    connected_account_id: process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    arguments: {"text":"New drop: agent teams that ship themselves."},
  }),
})
const { data, successful, error } = await r.json()
if (!successful) throw new Error(error ?? "composio.tools.execute failed")
\`\`\`

**Lookup post - \`TWITTER_POST_LOOKUP_BY_POST_ID\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/TWITTER_POST_LOOKUP_BY_POST_ID \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"id":"1234567890","tweet_fields":"public_metrics,created_at,author_id"}}'
# Response: { data: { data: { id, text, public_metrics: { retweet_count, like_count, reply_count } } }, successful: true }
\`\`\`

**Follow user - \`TWITTER_FOLLOW_USER\`:**

\`\`\`bash
curl -X POST https://backend.composio.dev/api/v3/tools/execute/TWITTER_FOLLOW_USER \\
  -H "X-API-Key: $COMPOSIO_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"user_id":"'"$COMPOSIO_USER_ID"'","connected_account_id":"'"$COMPOSIO_CONNECTED_ACCOUNT_ID"'","arguments":{"id":"<target-user-id>"}}'
# Response: { data: { data: { following: true, pending_follow_request: false } }, successful: true }
\`\`\`

## Response shape + error handling

Every \`composio.tools.execute\` response follows:
\`\`\`json
{ "data": { ... }, "successful": true, "error": null }
\`\`\`
Check \`successful\` before trusting \`data\`. Common failures:
- **Revoked OAuth** - \`successful: false\`, \`error\` carries a provider-specific message. Surface "reconnect Twitter/X" to the human.
- **Rate limits** - HTTP 429 with Composio forwarding the provider's throttle headers. Backoff and retry.
- **Missing env vars** - request rejected locally with \`COMPOSIO_*\` not set. Check the container's env if this ever fires in prod.`,
    type: "TOOL_SPECIFIC",
    category: "SOCIAL",
    icon: "🐤",
    compatibleTools: ["twitter"],
    requiresToolConnection: true,
    requiredToolCategory: "SOCIAL",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },

]
