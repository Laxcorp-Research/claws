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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    description: "Post, read, and search tweets via the Twitter/X API",
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
  // `buffer-social` skill removed in PR #4 — Composio has no `buffer` toolkit,
  // so this skill had no usable tool to bind to. Restoration tracked in the
  // "Template seed data drift" umbrella issue; remediation path is PR #6's
  // Custom API pipeline (buffer-api direct-token).
  {
    name: "YouTube Data API",
    slug: "youtube-data-api",
    description: "Manage YouTube channels, videos, and playlists",
    skillMd: `## Authentication
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
  // `beehiiv-newsletter` and `substack-newsletter` skills removed in PR #4 —
  // Composio has no `beehiiv` or `substack` toolkit. Beehiiv users can instead
  // use `beehiiv-api` (API_KEY_TOOLS, direct-token) via the MarketplaceSkill
  // `beehiiv-newsletter` row in marketplace-skills.ts. Substack has no current
  // remediation path; tracked in the umbrella drift issue.
  {
    name: "ConvertKit Newsletter",
    slug: "convertkit-newsletter",
    description: "Manage broadcasts and subscribers via ConvertKit",
    skillMd: `## Authentication
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
    description: "Manage issues and sprints via Linear GraphQL API",
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    skillMd: `## Authentication
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
    description: "Manage scheduling links and events via Composio",
    skillMd: `## Authentication
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
  // `wordpress-cms` skill removed in PR #4 — Composio has no `wordpress`
  // toolkit. WordPress users can still install the `wordpress-cms`
  // MarketplaceSkill (marketplace-skills.ts) which uses a direct
  // WORDPRESS_URL + WORDPRESS_TOKEN pair (no OAuth). Restoration as a
  // built-in skill tracked in the umbrella drift issue; built-in
  // restoration needs PR #6's Custom API pipeline (wordpress-api).
]
