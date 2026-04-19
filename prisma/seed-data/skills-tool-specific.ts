import { SeedSkill } from "./types"

export const TOOL_SPECIFIC_SKILLS: SeedSkill[] = [
  {
    name: "Tavily Search",
    slug: "tavily-search",
    description: "Real-time web search via the Tavily API",
    skillMd: `---
name: Tavily Search
description: Real-time web search via Tavily API
metadata:
  openclaw:
    emoji: 🔎
---

## Authentication
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

Use \`search_depth: "advanced"\` for deeper results. Default returns title, url, content, and score.`,
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
    description: "Manage contacts, deals, and companies in HubSpot",
    skillMd: `---
name: HubSpot CRM
description: Contacts and deals CRUD via HubSpot API
metadata:
  openclaw:
    emoji: 🔗
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Contact:**
\`\`\`bash
curl -X POST https://api.hubapi.com/crm/v3/objects/contacts \\
  -H "Authorization: Bearer <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"properties":{"email":"j@example.com","firstname":"Jane"}}'
\`\`\`

**List Deals:**
\`\`\`bash
curl https://api.hubapi.com/crm/v3/objects/deals \\
  -H "Authorization: Bearer <OAUTH_TOKEN>"
\`\`\`

**Search Contacts:**
\`\`\`bash
curl -X POST https://api.hubapi.com/crm/v3/objects/contacts/search \\
  -H "Authorization: Bearer <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"filterGroups":[{"filters":[{"propertyName":"email","operator":"EQ","value":"j@example.com"}]}]}'
\`\`\``,
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
    description: "Manage leads, opportunities, and accounts in Salesforce",
    skillMd: `---
name: Salesforce CRM
description: Leads and opportunities via Salesforce REST API
metadata:
  openclaw:
    emoji: ☁️
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

Salesforce REST endpoints use the instance URL + Bearer token pair; both are injected by Composio at tool-invocation time (see \`{instance_url}\` / \`<OAUTH_TOKEN>\` as placeholders below).

## Key Endpoints

**Create Lead:**
\`\`\`bash
curl -X POST {instance_url}/services/data/v59.0/sobjects/Lead \\
  -H "Authorization: Bearer <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"FirstName":"Jane","LastName":"Doe","Company":"Acme"}'
\`\`\`

**Query Opportunities:**
\`\`\`bash
curl "{instance_url}/services/data/v59.0/query?q=SELECT+Id,Name,Amount+FROM+Opportunity" \\
  -H "Authorization: Bearer <OAUTH_TOKEN>"
\`\`\``,
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
    skillMd: `---
name: Apollo Search
description: B2B people search and enrichment via Apollo API
metadata:
  openclaw:
    emoji: 🚀
---

## Authentication
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
    skillMd: `---
name: Clay Enrichment
description: Multi-source enrichment via Clay API
metadata:
  openclaw:
    emoji: 🧱
---

## Authentication
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
    skillMd: `---
name: Instantly Email
description: Cold email campaigns via Instantly API
metadata:
  openclaw:
    emoji: ⚡
---

## Authentication
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
    description: "Post, read, and search tweets via the Twitter/X API",
    skillMd: `---
name: Twitter API
description: Post, read, and search tweets via Twitter API v2
metadata:
  openclaw:
    emoji: 🐦
---

## Authentication
Set \`$TWITTER_API_KEY\` to your Twitter Bearer token.

## Key Endpoints

**Post Tweet:**
\`\`\`bash
curl -X POST https://api.twitter.com/2/tweets \\
  -H "Authorization: Bearer $TWITTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Hello from LaxClaws!"}'
\`\`\`

**Search Tweets:**
\`\`\`bash
curl "https://api.twitter.com/2/tweets/search/recent?query=AI%20agents&max_results=10" \\
  -H "Authorization: Bearer $TWITTER_API_KEY"
\`\`\`

**Get User Timeline:**
\`\`\`bash
curl "https://api.twitter.com/2/users/{id}/tweets?max_results=10" \\
  -H "Authorization: Bearer $TWITTER_API_KEY"
\`\`\``,
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
    description: "Manage LinkedIn posts and profiles via Composio OAuth",
    skillMd: `---
name: LinkedIn API
description: LinkedIn posts and profile management via Composio OAuth
metadata:
  openclaw:
    emoji: 💼
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Create and share posts on LinkedIn
- Read profile information
- Manage connections and invitations
- Comment and react to posts

Composio handles the full OAuth2 flow. No manual token management required.`,
    type: "TOOL_SPECIFIC",
    category: "SOCIAL",
    icon: "💼",
    compatibleTools: ["linkedin"],
    requiresToolConnection: true,
    requiredToolCategory: "SOCIAL",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Buffer Social",
    slug: "buffer-social",
    description: "Schedule and publish social media posts via Buffer",
    skillMd: `---
name: Buffer Social
description: Schedule social posts via Buffer API
metadata:
  openclaw:
    emoji: 📱
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Post:**
\`\`\`bash
curl -X POST https://api.bufferapp.com/1/updates/create.json \\
  -H "Authorization: Bearer <OAUTH_TOKEN>" \\
  -d "text=Check out our new launch!&profile_ids[]=abc123&scheduled_at=2025-03-01T10:00:00Z"
\`\`\`

**List Profiles:**
\`\`\`bash
curl https://api.bufferapp.com/1/profiles.json \\
  -H "Authorization: Bearer <OAUTH_TOKEN>"
\`\`\`

Supports Twitter, LinkedIn, Facebook, Instagram, and more via connected profiles.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "📱",
    compatibleTools: ["buffer"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "YouTube Data API",
    slug: "youtube-data-api",
    description: "Manage YouTube channels, videos, and playlists",
    skillMd: `---
name: YouTube Data API
description: Channel and video management via YouTube Data API v3
metadata:
  openclaw:
    emoji: 🎬
---

## Authentication
Set \`$YOUTUBE_DATA_API_KEY\` to your YouTube Data API key (or OAuth token for writes).

## Key Endpoints

**Search Videos:**
\`\`\`bash
curl "https://www.googleapis.com/youtube/v3/search?part=snippet&q=AI+agents&type=video&key=$YOUTUBE_DATA_API_KEY"
\`\`\`

**Get Channel Stats:**
\`\`\`bash
curl "https://www.googleapis.com/youtube/v3/channels?part=statistics&id=CHANNEL_ID&key=$YOUTUBE_DATA_API_KEY"
\`\`\`

**List Playlists:**
\`\`\`bash
curl "https://www.googleapis.com/youtube/v3/playlists?part=snippet&channelId=CHANNEL_ID&key=$YOUTUBE_DATA_API_KEY"
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "🎬",
    compatibleTools: ["youtube-data-api"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Beehiiv Newsletter",
    slug: "beehiiv-newsletter",
    description: "Manage newsletter posts and subscribers via Beehiiv",
    skillMd: `---
name: Beehiiv Newsletter
description: Newsletter posts and subscribers via Beehiiv API
metadata:
  openclaw:
    emoji: 🐝
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Post:**
\`\`\`bash
curl -X POST "https://api.beehiiv.com/v2/publications/{publication_id}/posts" \\
  -H "Authorization: Bearer <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Weekly Update","subtitle":"What happened this week","content_html":"<p>Hello!</p>"}'
\`\`\`

**List Subscribers:**
\`\`\`bash
curl "https://api.beehiiv.com/v2/publications/{publication_id}/subscriptions" \\
  -H "Authorization: Bearer <OAUTH_TOKEN>"
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "🐝",
    compatibleTools: ["beehiiv"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "Substack Newsletter",
    slug: "substack-newsletter",
    description: "Publish newsletter posts on Substack (limited API)",
    skillMd: `---
name: Substack Newsletter
description: Substack newsletter management (limited API)
metadata:
  openclaw:
    emoji: 📰
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

Substack has a limited official API; this skill is best-effort against unofficial / partner endpoints. The OAuth token is injected by Composio at runtime.

## Notes
- Substack does not offer a full public REST API as of 2025.
- Reading posts is possible via the RSS feed at \`https://yourpub.substack.com/feed\`.
- For write operations, consider using browser automation or the Substack editor API if whitelisted.
- Monitor Substack's developer docs for future API availability.

Best used for read-only integrations or alongside manual publishing workflows.`,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "📰",
    compatibleTools: ["substack"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
  {
    name: "ConvertKit Newsletter",
    slug: "convertkit-newsletter",
    description: "Manage broadcasts and subscribers via ConvertKit",
    skillMd: `---
name: ConvertKit Newsletter
description: Broadcasts and subscribers via ConvertKit API
metadata:
  openclaw:
    emoji: 💌
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Broadcast:**
\`\`\`bash
curl -X POST https://api.convertkit.com/v3/broadcasts \\
  -H "Content-Type: application/json" \\
  -d '{"api_secret":"'<OAUTH_TOKEN>'","subject":"Weekly Digest","content":"<p>Hello subscribers!</p>"}'
\`\`\`

**List Subscribers:**
\`\`\`bash
curl "https://api.convertkit.com/v3/subscribers?api_secret=<OAUTH_TOKEN>&page=1"
\`\`\`

**Add Subscriber to Form:**
\`\`\`bash
curl -X POST "https://api.convertkit.com/v3/forms/{form_id}/subscribe" \\
  -H "Content-Type: application/json" \\
  -d '{"api_secret":"'<OAUTH_TOKEN>'","email":"j@example.com"}'
\`\`\``,
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
    skillMd: `---
name: Binance Trading
description: Crypto prices and orders via Binance API
metadata:
  openclaw:
    emoji: ₿
---

## Authentication
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
    skillMd: `---
name: Coinbase Trading
description: Crypto trading via Coinbase Advanced Trade API
metadata:
  openclaw:
    emoji: 🪙
---

## Authentication
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
    skillMd: `---
name: Alpaca Trading
description: US stock trading via Alpaca API
metadata:
  openclaw:
    emoji: 📈
---

## Authentication
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
    skillMd: `---
name: Polymarket Trading
description: Prediction market trading via Polymarket API
metadata:
  openclaw:
    emoji: 🎯
---

## Authentication
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
    description: "Manage issues and sprints via Linear GraphQL API",
    skillMd: `---
name: Linear PM
description: Issues and sprints via Linear GraphQL API
metadata:
  openclaw:
    emoji: 📐
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Issue:**
\`\`\`bash
curl -X POST https://api.linear.app/graphql \\
  -H "Authorization: <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"mutation { issueCreate(input: { teamId: \\"TEAM_ID\\", title: \\"Fix bug\\", priority: 2 }) { success issue { id identifier } } }"}'
\`\`\`

**List Issues:**
\`\`\`bash
curl -X POST https://api.linear.app/graphql \\
  -H "Authorization: <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"{ issues(first: 10) { nodes { id title state { name } } } }"}'
\`\`\`

Linear uses GraphQL exclusively. Use mutations for writes, queries for reads.`,
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
    description: "Manage tasks and projects in Asana via Composio",
    skillMd: `---
name: Asana PM
description: Task and project management via Asana (Composio OAuth)
metadata:
  openclaw:
    emoji: 🎯
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Create and update tasks
- Manage projects and sections
- Assign tasks to team members
- Track task completion and due dates

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    description: "Manage tasks and spaces in ClickUp via Composio",
    skillMd: `---
name: ClickUp PM
description: Task and space management via ClickUp (Composio OAuth)
metadata:
  openclaw:
    emoji: ✅
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Create and manage tasks, subtasks, and checklists
- Organize workspaces, spaces, and folders
- Set priorities, due dates, and assignees
- Track time and custom fields

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    description: "Manage issues and sprints in Jira via Composio",
    skillMd: `---
name: Jira PM
description: Issue and sprint management via Jira (Composio OAuth)
metadata:
  openclaw:
    emoji: 🔵
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Create and update issues (stories, bugs, tasks, epics)
- Manage sprints and boards
- Transition issue statuses through workflows
- Add comments and attachments

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    description: "Send messages and manage channels in Slack via Composio",
    skillMd: `---
name: Slack Messaging
description: Channel messaging via Slack (Composio OAuth)
metadata:
  openclaw:
    emoji: 💬
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Send messages to channels and DMs
- Create and manage channels
- Upload files and snippets
- Read message history and threads

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    description: "Manage pages and databases in Notion via Composio",
    skillMd: `---
name: Notion Docs
description: Pages and databases via Notion (Composio OAuth)
metadata:
  openclaw:
    emoji: 📝
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Create and update pages and blocks
- Query and update databases
- Search across workspace content
- Manage page properties and relations

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    description: "Manage products, orders, and inventory via Shopify API",
    skillMd: `---
name: Shopify Store
description: Products and orders via Shopify Admin API
metadata:
  openclaw:
    emoji: 🛍️
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**List Products:**
\`\`\`bash
curl "https://{shop}.myshopify.com/admin/api/2024-01/products.json" \\
  -H "X-Shopify-Access-Token: <OAUTH_TOKEN>"
\`\`\`

**Create Order:**
\`\`\`bash
curl -X POST "https://{shop}.myshopify.com/admin/api/2024-01/orders.json" \\
  -H "X-Shopify-Access-Token: <OAUTH_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"order":{"line_items":[{"variant_id":123,"quantity":1}]}}'
\`\`\`

**Get Inventory Levels:**
\`\`\`bash
curl "https://{shop}.myshopify.com/admin/api/2024-01/inventory_levels.json?location_ids=LOC_ID" \\
  -H "X-Shopify-Access-Token: <OAUTH_TOKEN>"
\`\`\``,
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
    skillMd: `---
name: Google Search Console
description: Search performance and indexing via Google Search Console (Composio OAuth)
metadata:
  openclaw:
    emoji: 📊
---

## Authentication
Via Composio OAuth — auth managed automatically.

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
    description: "GA4 reporting and audience data via Composio",
    skillMd: `---
name: Google Analytics
description: GA4 reporting via Google Analytics (Composio OAuth)
metadata:
  openclaw:
    emoji: 📈
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- Run GA4 Data API reports (sessions, users, pageviews)
- Query real-time data
- Access audience and conversion metrics
- List account properties and data streams

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    skillMd: `---
name: Ahrefs SEO
description: Keywords and backlinks via Ahrefs API
metadata:
  openclaw:
    emoji: 🔗
---

## Authentication
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
    description: "Manage scheduling links and events via Composio",
    skillMd: `---
name: Calendly Scheduling
description: Scheduling and events via Calendly (Composio OAuth)
metadata:
  openclaw:
    emoji: 📅
---

## Authentication
Via Composio OAuth — auth managed automatically.

## Capabilities
- List and manage event types
- Get scheduled events and invitees
- Create one-off scheduling links
- Handle webhook events for bookings

Composio handles the full OAuth2 flow. No manual token management required.`,
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
    skillMd: `---
name: Twilio SMS
description: Send and receive SMS via Twilio API
metadata:
  openclaw:
    emoji: 📱
---

## Authentication
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
  {
    name: "WordPress CMS",
    slug: "wordpress-cms",
    description: "Create and manage posts, pages, and media via WordPress REST API",
    skillMd: `---
name: WordPress CMS
description: Posts and pages via WordPress REST API
metadata:
  openclaw:
    emoji: 📝
---

## Authentication
Authenticated via Composio OAuth; \`<OAUTH_TOKEN>\` in the examples below is a placeholder for the token Composio injects at runtime — do NOT try to read it from an env var. Use \`composio.tools.execute()\` to invoke these endpoints.

## Key Endpoints

**Create Post:**
\`\`\`bash
curl -X POST "{site}/wp-json/wp/v2/posts" \\
  -u REDACTED \\
  -H "Content-Type: application/json" \\
  -d '{"title":"New Post","content":"<p>Hello world!</p>","status":"draft"}'
\`\`\`

**List Posts:**
\`\`\`bash
curl "{site}/wp-json/wp/v2/posts?per_page=10" \\
  -u REDACTED
\`\`\`

**Upload Media:**
\`\`\`bash
curl -X POST "{site}/wp-json/wp/v2/media" \\
  -u REDACTED \\
  -H "Content-Disposition: attachment; filename=image.png" \\
  --data-binary @image.png
\`\`\``,
    type: "TOOL_SPECIFIC",
    category: "CONTENT",
    icon: "📝",
    compatibleTools: ["wordpress"],
    requiresToolConnection: true,
    requiredToolCategory: "CONTENT",
    isBuiltIn: false,
    permissions: ["internet_access"],
  },
]
