// PR2.8a Task 0 — DB state probe.
//
// Classifies the database against the expected post-PR2.8a slug set to
// determine whether a re-seed is safe (state 1), safe with re-seed required
// (state 2), or blocked on a data migration (state 3).
//
// Output: a JSON blob to stdout matching the shape documented in the
// revised PR2.8a prompt (Task 0 section). Redirect to a file per env:
//
//   DATABASE_URL=<staging-url> node scripts/pr2.8a-probe.mjs > probe-staging.json
//   DATABASE_URL=<prod-url>    node scripts/pr2.8a-probe.mjs > probe-prod.json
//
// Uses the `pg` driver directly rather than the Prisma client because the
// repo's generated Prisma client may be newer than prod's deployed schema.
// Raw queries against JSONB are narrower in scope and version-insensitive.

import { readFileSync } from 'node:fs'
import pg from 'pg'

// Load DATABASE_URL from ambient env or .env.local (never from .env.staging
// or .env.production — operator passes those explicitly).
if (!process.env.DATABASE_URL) {
  try {
    const content = readFileSync('.env.local', 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch { /* missing .env.local is fine — DATABASE_URL must be set explicitly then */ }
}

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set. Pass explicitly, e.g.')
  console.error('  DATABASE_URL=$STAGING_DATABASE_URL node scripts/pr2.8a-probe.mjs > probe-staging.json')
  process.exit(1)
}

// EXPECTED_SLUG_SET = post-PR2.8a catalog slug set.
// Matches the state after Tasks 1–4 land:
//   - Every existing tool-catalog.ts slug (46 entries, youtube-data-api still
//     present but flagged `deprecated: true` — kept in the set because
//     deprecation is a soft marker, not a deletion).
//   - 18 Composio adds from Task 2 (includes pipedrive per decision-pass-2).
//   - 21 placeholder adds from Task 3 (includes kalshi + smartlead per
//     decision-pass-2).
// Total: 85 slugs.
//
// Hard-coded here (not imported from ALL_TOOL_SLUGS) because this script
// runs against prod BEFORE the catalog changes land — we want the probe to
// compare against the *target* set, not whatever the checked-out catalog
// currently says. Any divergence is the signal we need to classify.
const EXPECTED_SLUG_SET = new Set([
  // Existing API_KEY_TOOLS (29)
  'anthropic_api', 'tavily', 'serp_api', 'exa_search', 'brave_search',
  'apollo', 'clay', 'instantly', 'sendgrid', 'mailgun', 'cal_com',
  'stripe_api', 'polymarket', 'binance', 'alpaca', 'coinbase',
  'youtube-data-api', 'twitter-api', 'google-search-console', 'ahrefs',
  'semrush', 'twilio', 'posthog', 'mixpanel', 'elevenlabs', 'stabilityai',
  'vidiq', 'salesforce-api', 'beehiiv-api',
  // Existing OAUTH_TOOLS (17)
  'hubspot', 'salesforce', 'gmail', 'google_calendar', 'google-analytics',
  'slack', 'github', 'linear', 'asana', 'clickup', 'notion', 'linkedin',
  'twitter', 'convertkit', 'shopify', 'jira', 'calendly',
  // Task 2 Composio adds (19, with pipedrive per orphan-resolution decision
  // + googledrive per post-probe operator decision to catalog the existing
  // staging ToolConnection row)
  'typefully', 'docusign', 'follow_up_boss', 'freshbooks', 'gitlab',
  'googleads', 'googledocs', 'googledrive', 'harvest', 'jotform',
  'lever', 'metaads', 'outlook', 'quickbooks', 'toggl', 'typeform',
  'webflow', 'youtube', 'pipedrive',
  // Task 3 placeholder adds (21, with kalshi + smartlead per orphan-resolution)
  'buffer', 'wordpress', 'amazon_sp_api', 'greenhouse', 'clio', 'mycase',
  'servicetitan', 'housecall_pro', 'drchrono', 'google_business_profile',
  'bullhorn', 'snyk', 'keepa', 'sparkloop', 'kraken', 'apple_calendar',
  'athena_health', 'upwork', 'zillow',
  'kalshi', 'smartlead',
])

// Parse the pg URL into its hostname for output (don't echo credentials).
function safeHostFromUrl(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname ? u.pathname : ''}`
  } catch {
    return '(unparseable)'
  }
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('neon') || process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
})
await client.connect()

try {
  // 1. Distinct template slugs
  const tplRes = await client.query('SELECT slug FROM "ClawTemplate" ORDER BY slug')
  const templateSlugs = tplRes.rows.map((r) => r.slug)

  // 2. Distinct slugs inside workspaceSnapshot.tools[*].slug across every template
  //    workspaceSnapshot is stored as TEXT (per schema.prisma:562), not JSONB,
  //    so cast to jsonb before path-extracting.
  const snapshotRes = await client.query(`
    SELECT DISTINCT jsonb_array_elements("workspaceSnapshot"::jsonb -> 'tools') ->> 'slug' AS tool_slug
    FROM "ClawTemplate"
    WHERE "workspaceSnapshot" IS NOT NULL
      AND "workspaceSnapshot" <> ''
  `)
  const workspaceSnapshotToolSlugs = snapshotRes.rows
    .map((r) => r.tool_slug)
    .filter((s) => typeof s === 'string' && s.length > 0)
    .sort()

  // 3. Distinct ToolConnection slugs + their row counts
  const connRes = await client.query(`
    SELECT "toolSlug" AS slug, COUNT(*)::int AS count
    FROM "ToolConnection"
    GROUP BY "toolSlug"
    ORDER BY "toolSlug"
  `)
  const toolConnectionSlugs = connRes.rows.map((r) => ({ slug: r.slug, count: r.count }))

  // 4. Classify: any ToolConnection.toolSlug NOT in EXPECTED_SLUG_SET is stale
  const staleConnectionSlugs = toolConnectionSlugs
    .filter((r) => !EXPECTED_SLUG_SET.has(r.slug))
    .map((r) => r.slug)

  // 5. Also surface workspaceSnapshot slugs not in expected set (informational —
  //    these get updated by the re-seed and don't require a migration)
  const staleSnapshotToolSlugs = workspaceSnapshotToolSlugs.filter(
    (s) => !EXPECTED_SLUG_SET.has(s),
  )

  const output = {
    env: safeHostFromUrl(process.env.DATABASE_URL),
    timestamp: new Date().toISOString(),
    expectedSlugSetSize: EXPECTED_SLUG_SET.size,
    templateSlugs,
    templateCount: templateSlugs.length,
    workspaceSnapshotToolSlugs,
    workspaceSnapshotToolSlugsCount: workspaceSnapshotToolSlugs.length,
    staleSnapshotToolSlugs,
    toolConnectionSlugs,
    toolConnectionRowTotal: toolConnectionSlugs.reduce((a, r) => a + r.count, 0),
    staleConnectionsDetected: staleConnectionSlugs.length > 0,
    staleConnectionSlugs,
  }

  console.log(JSON.stringify(output, null, 2))
} finally {
  await client.end()
}
