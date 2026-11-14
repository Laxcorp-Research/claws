# PR2.8 Audit Decisions - Locked

Resolutions for the Q1–Q9 open questions in `docs/PR2.8_AUDIT_FINDINGS.md` §5,
plus the scope split across PR2.8a / PR2.8b / PR2.8c that the audit surfaced
but didn't formalize. This doc is the durable record - the findings doc keeps
its historical framing (including the wrong-file measurement error corrected
at its top).

---

## Q1 - PR4 orphans (Buffer, Typefully, WordPress)

- **Buffer** → `comingSoon: true` placeholder. Direct integration ships in
  PR2.8c (Buffer access token).
- **Typefully** → Added via Composio (toolkit id `typefully`, API_KEY auth).
  Not an orphan - the PR4 blanket removal missed that Composio actually
  publishes this toolkit.
- **WordPress** → `comingSoon: true` placeholder. Direct integration in
  PR2.8c (URL + user + application password).

## Q2 - Vertical tools with real APIs but not on Composio

All 16 shipped as `comingSoon: true` placeholders in PR2.8a Task 3. Direct
integrations land in PR2.8c. Template copy retains the references so typed
slug links stay intact; wizard resolver filters comingSoon entries from
render until PR2.8c activates them.

## Q3 - Products without viable server APIs

Dropped entirely from seed templates in PR2.8a Task 6:
- **Apple Health** - removed from Health & Fitness Commander recommended.
- **Google Fit** - removed from Health & Fitness Commander recommended.
- **MLS/IDX feed** - not present as a typed seed entry; was display-string
  only in the dead `claw-templates.ts`. No seed edit needed.
- **Substack** - dropped from Newsletter Empire's `Beehiiv or Substack or
  ConvertKit` compound (compound becomes `{ slug: "beehiiv-api",
  alternatives: ["convertkit"] }`).
- **TubeBuddy** - was not in seed; no edit. Display-string-only in dead file.

**Apple Calendar** is NOT dropped - added as a `comingSoon: true` placeholder
with CalDAV auth planned for PR2.8c, so Calendar-requiring templates get a
fourth option once it ships.

## Q4 - "HIPAA-compliant SMS (Twilio BAA)"

Seed already had `slug: "twilio"` for this entry; display-string was only in
the dead `claw-templates.ts`. Added a sentence to the Medical Practice Manager
template `description` explaining that HIPAA-compliant deployment requires
Twilio's BAA configuration. No separate `twilio-hipaa` catalog entry - BAA is
an account-level Twilio setup decision, not a different integration.

## Q5 - Calendar ambiguity

**Option B (promote to `oneOf`).** Every template currently referencing
`google_calendar` gets `alternatives: ["outlook", "cal_com", "apple_calendar"]`
attached. Wizard resolver picks the first already-connected option, else the
first non-`comingSoon` option (= `google_calendar`), else the primary. Today's
users see `google_calendar` as the default - behavior-identical to pre-PR2.8a
rendering. PR2.8b adds an explicit picker so users can choose Outlook/Cal.com
on first deploy.

## Q6 - Dual-integration policy

- **Tavily** → keep as `tavily` API_KEY only in catalog. Composio's Tavily
  toolkit exists (5 tools) but the direct API_KEY path is simpler for users
  and already works; no parallel entry added.
- **YouTube Data API** → deprecate `youtube-data-api` (catalog flag set in
  PR2.8a Task 4) and switch seeds to `youtube` (OAUTH_COMPOSIO, 47 tools).
  Deprecated slug stays in catalog for historical `ToolConnection` rows.
  Prod has zero connections on the slug today (per state 1 probe);
  removable in a later PR.
- **Coinbase** → keep `coinbase` (= Coinbase Exchange, 3-field API_KEY) as
  the canonical catalog slug. Composio's `coinbase` (28 tools) is a distinct
  product surface (Coinbase brand, not Exchange); adding Composio's version
  would collide on the slug. Defer to a future PR if demand surfaces; right
  now the existing direct API_KEY works for the Quant Trader template.
- **Shopify** → existing `shopify` OAUTH_COMPOSIO unchanged; Composio already
  bridges the Shopify API shape we expose.
- **Stripe** → keep `stripe_api` API_KEY only. Direct API keys are simpler
  than Stripe OAuth for the payment-processing surface our templates need.

## Q7 - Icon sourcing policy

**Self-host.** One-time fetch + commit to `public/tool-icons/<slug>.svg`
(or `.png`). Deferred to PR2.8b - no icon field exists on `ToolDefinition`
today anyway; PR2.8b introduces it alongside the picker UI.

## Q8 - Migration strategy

**Option B (multi-PR).** Scope split:

- **PR2.8a (this PR)** - type-system foundation + catalog enrichment. Adds
  17 Composio + 19 placeholder catalog entries (later revised to 19 + 21
  after orphan-resolution folded in Pipedrive / Google Drive / Kalshi /
  Smartlead), `ToolSlug` literal union, `ALL_TOOL_SLUGS` const,
  `comingSoon` / `deprecated` flags, seed slug reconciliation, wizard
  resolver slug-based, `TOOL_NAME_ALIASES` / `getToolByName` removal,
  seed.ts upsert conversion (folded in as Task 0.6 after the pre-flight
  halt surfaced a cascade-delete footgun). User-invisible at runtime -
  wizard render is identical to today for every existing template.
- **PR2.8b** - wizard UI for `oneOf` (picker) + `comingSoon` (badge) +
  icon field on `ToolDefinition` + self-hosted icons for PR2.8a adds.
- **PR2.8c** - 16 direct integrations activate their `comingSoon`
  placeholders: Buffer, WordPress, Greenhouse, Clio, MyCase, ServiceTitan,
  Housecall Pro, DrChrono, Google Business Profile, Bullhorn, Snyk, Keepa,
  SparkLoop, Kraken, Amazon SP-API, Apple Calendar (via CalDAV). Plus
  orphan-resolution additions: Kalshi, Smartlead.

## Q9 - `ToolSlug` union size

Post-PR2.8a: **86 slugs** (46 existing + 19 Task 2 Composio adds + 21 Task 3
placeholders). Larger than the original audit's estimate of 61 because the
decision-pass-2 folded in three extra Composio entries (Pipedrive,
Google Drive, Typefully) and two extra placeholders (Kalshi, Smartlead). Size
is still manageable for a hand-maintained `ALL_TOOL_SLUGS` - TypeScript
autocompletion remains responsive at this scale per IDE profiling.

---

## Task 0.6 - seed.ts upsert conversion (pre-flight discovery)

Not in the original scope, added as a prerequisite block after the pre-flight
schema + seed audit surfaced three issues:

1. `TemplateReview.clawTemplateId` FK is `ON DELETE CASCADE` - running the
   original `deleteMany() + create()` seed against any populated DB wiped
   every user's reviews on seed templates.
2. `TemplateInstall.templateId` FK is `ON DELETE CASCADE` - same class.
3. `Purchase.clawTemplateId` FK is `ON DELETE RESTRICT` - the seed would
   outright fail (not silently) the moment a paid template had a Purchase
   row, failing in the middle of the run.

Task 0.6 converted `prisma/seed.ts` to `upsert`-by-slug for ClawTemplate
(same pattern PR #3a applied to Skill) and the same treatment for
OpenClawVersion (has no incoming FKs today but consistency pattern). Manual
mutation-test procedure documented as a comment block in `seed.ts`.

---

## Open items (explicitly deferred)

- **`test-template` staging orphan** - a manually-inserted ClawTemplate row
  not in `ALL_TEMPLATES`. Upsert-by-slug leaves it alone; no cleanup in
  PR2.8a. Operator may clean up post-merge via a dedicated SQL step if
  desired.
- **Staging legacy marketplace-skill review/install rows** - the scoped
  `deleteMany` pattern at `prisma/seed.ts:106-108` for seed-catalog
  marketplace skills still destructively wipes user reviews/installs on
  seed skills every re-seed. PR2.8a leaves this alone (different pattern
  class, separate PR to fix). Flagged for the same class of follow-up as
  the ClawTemplate fix.
- **GH #41 Asana Test button** - the PR2.8a adds (19 new OAUTH_COMPOSIO
  toolkits) are all in `UNSUPPORTED_TOOLKITS` in `cheap-ops.ts`. Each needs
  a zero-arg whoami op verified against Composio's SDK before graduating
  to `CHEAP_OPS` (the Test button surface). Batched into PR2.8b alongside
  the picker UI.
- **Category refinement** - several PR2.8a adds use "closest existing"
  categories (ANALYTICS for ads, CRM for legal/medical, PROJECT_MANAGEMENT
  for time tracking) because TOOL_CATEGORIES lacks ADVERTISING /
  HEALTHCARE / LEGAL / ACCOUNTING buckets. PR2.8b decision whether to
  expand `TOOL_CATEGORIES` or keep the current shape.
