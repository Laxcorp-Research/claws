# PR2.8 Phase A Audit — Tool Catalog Completeness

> **2026-04-30 correction:** This audit doc was authored against
> `src/data/claw-templates.ts`, which Cursor's PR2.8a pre-flight verification
> proved is dead code for the wizard. The actual runtime data flow runs
> through `prisma/seed-data/*.ts` → `ClawTemplate.workspaceSnapshot` →
> `/api/templates/{slug}` → setup wizard. The "66/146 broken refs" and
> "20/20 templates Deploy-blocked" counts below were measured against the
> wrong file — in the wizard path, pre-PR2.7 blockers were narrower (the
> `"Twitter API"` alias was load-bearing; the `"Claude API"` alias never
> fired because seeds use `name: "Anthropic"` which substring-resolved to
> `anthropic_api` + got filtered by the `isAIProvider` gate).
>
> The Q1–Q9 decisions in this doc are still valid; the impact analysis
> was overstated. See `docs/PR2.8_AUDIT_DECISIONS.md` for the locked
> decisions actually executed in PR2.8a.

**Scope:** Read-only audit. No code changes. Output = this doc + `tmp/composio-toolkits.txt` (gitignored).

**Audit state:** `origin/main` @ `08a54d3` (post-PR2.7), verified 2026-04-29.

**Inputs cross-referenced:**
- `src/data/tool-catalog.ts` — 46 entries (29 API_KEY + 17 OAUTH_COMPOSIO)
- `src/data/claw-templates.ts` — 20 templates, `requiredTools` + `recommendedTools` fields
- `tmp/composio-toolkits.txt` — 1030 Composio toolkits (dumped 2026-04-29 via `node tmp/list-composio-toolkits.mjs`)

---

## Section 1 — Catalog state

**Total tools in `ALL_TOOLS`: 46** (`ALL_TOOLS = [...API_KEY_TOOLS, ...OAUTH_TOOLS]` at `src/data/tool-catalog.ts:206`)

### Active (46)

**API_KEY (29):**
`anthropic_api` (AI/isAIProvider), `tavily`, `serp_api`, `exa_search`, `brave_search`, `apollo`, `clay`, `instantly`, `sendgrid`, `mailgun`, `cal_com`, `stripe_api`, `polymarket`, `binance`, `alpaca`, `coinbase` (= Coinbase Exchange), `youtube-data-api`, `twitter-api`, `google-search-console`, `ahrefs`, `semrush`, `twilio`, `posthog`, `mixpanel`, `elevenlabs`, `stabilityai`, `vidiq`, `salesforce-api`, `beehiiv-api`

**OAUTH_COMPOSIO (17):**
`hubspot`, `salesforce`, `gmail`, `google_calendar` (composio slug `googlecalendar`), `google-analytics`, `slack`, `github`, `linear`, `asana`, `clickup`, `notion`, `linkedin`, `twitter`, `convertkit` (composio slug `kit`), `shopify`, `jira`, `calendly`

### Orphan / PR4-removed (3) — templates still reference these

Confirmed absent from `ALL_TOOLS`:
- **Buffer** — removed in PR4 (header comment at `tool-catalog.ts:170-177`: "Composio does not publish matching toolkit"). Composio list confirms: **not present**.
- **Typefully** — never in catalog. **Composio list DOES include it** (slug `typefully`, 5 tools, API_KEY auth). PR4 reasoning doesn't apply here — it's addable.
- **WordPress** — removed in PR4. Composio list confirms: **not present**.

### Deprecated (0)

No entries flagged deprecated. (Composio's `deprecated` flag was checked against the catalog; no matches.)

### Catalog alias map (`TOOL_NAME_ALIASES`, PR2.7 workaround)

```ts
export const TOOL_NAME_ALIASES: Record<string, string> = {
  "Claude API": "anthropic_api",
  "Twitter API": "twitter-api",
}
```

Paper-over for two template display-name mismatches. PR2.8 removes it once templates reference slugs directly.

---

## Section 2 — Architectural findings

### `getToolByName` substring matcher — call sites

Defined at `src/data/tool-catalog.ts:237`. Checks alias map first, falls through to bidirectional substring matching against `t.name`.

**Production call sites:** 1
| File | Line | Usage |
|---|---|---|
| `src/app/setup/[workspaceId]/step/[n]/page.tsx` | 416 | `buildToolState` — resolves template `requiredTools`/`recommendedTools` strings to catalog entries |

**Test-only call sites:** 1 file (`src/data/__tests__/tool-catalog-aliases.test.ts`).

**Risk notes:**
- Bidirectional `.includes(...)` false-positives when one tool name is a substring of another (e.g., "Tavily" contains "avil", "Apollo" matches "Apollo.io", "Beehiiv or Substack or ConvertKit" substring-hits `convertkit` by accident).
- False-negatives when template names add noise that isn't in the catalog name (`"Claude API"` vs `"Anthropic (Claude)"` — addressed by alias map).
- Compound template strings (`"Shopify or Amazon SP-API"`) currently "resolve by accident" to whichever catalog tool the substring matcher hits first — a lucky matcher, not a designed one.

**Path to typed slug union:**
```ts
// src/data/tool-catalog.ts — add typed export
export const ALL_TOOL_SLUGS = ALL_TOOLS.map((t) => t.slug) as const
export type ToolSlug = typeof ALL_TOOL_SLUGS[number]

// src/data/claw-templates.ts — switch field types
requiredTools: Array<ToolSlug | { oneOf: ToolSlug[] }>
recommendedTools: Array<ToolSlug | { oneOf: ToolSlug[] }>
```
Compile-time validation kills the display-name-drift class of bugs entirely; `getToolByName` becomes vestigial.

### Current field types (`src/data/claw-templates.ts:21-22`)

```ts
requiredTools: string[]
recommendedTools: string[]
```
No type-level link to `ALL_TOOLS`. Any typo ships silently to production.

### Compound strings

Scanned every `requiredTools` / `recommendedTools` array. Connectors in use: `" or "`. No `" / "` or `" + "` found.

| Template | Field | Raw string | Atomic decomposition |
|---|---|---|---|
| E-Commerce Profit Maximizer | required | `"Shopify or Amazon SP-API"` | `shopify` · `amazon-sp-api` (not yet in catalog) |
| Newsletter Empire | required | `"Beehiiv or Substack or ConvertKit"` | `beehiiv-api` · `substack` (not on Composio) · `convertkit` |
| Agency Operations OS | required | `"Linear or Asana or ClickUp"` | `linear` · `asana` · `clickup` |
| Founder's Chief of Staff | required | `"Gmail or Outlook"` | `gmail` · `outlook` (addable via Composio) |
| Developer Productivity OS | required | `"GitHub or GitLab"` | `github` · `gitlab` (addable via Composio) |

### Non-tool / descriptive references

| Template | Field | Raw string | Recommendation |
|---|---|---|---|
| Medical Practice Manager | required | `"HIPAA-compliant SMS (Twilio BAA)"` | Substring-resolves to `twilio`. Recommendation: **replace with `twilio` slug; move HIPAA/BAA note to template description**. Flagged in §5 — operator should confirm BAA config doesn't require a separate catalog entry. |
| Real Estate Agent OS | recommended | `"MLS/IDX feed"` | Not a single product; generic reference to real estate listing feeds. Recommendation: **drop** (operator decision in §5) or move to template description. |

---

## Section 3 — Per-tool decision table

**77 distinct tool atoms** across all 20 templates (compound strings decomposed).

Sort order: **orphans → Add via Composio → Add as direct → Drop → Already correct**. Column key:
- **In catalog?** — yes (slug shown), alias (aliased target), no
- **Composio toolkit ID** — slug if present in `tmp/composio-toolkits.txt`, or "—" if absent
- **Auth type** — connection method for the proposed integration
- **Recommended action** — one of the 5 defined values
- **Operator decision** — blank (for you to fill before Phase B)

### Orphans (3)

| Tool | Templates using it | In catalog? | Composio toolkit ID | Auth type | Recommended action | Notes | Operator decision |
|---|---|---|---|---|---|---|---|
| Buffer | YouTube Channel OS (rec), Twitter/X Growth Machine (rec), Newsletter Empire (rec), Podcast Production Studio (rec) — **4 uses** | no (removed PR4) | — | n/a | **Resolve orphan** | PR4 removed. Composio has no matching toolkit. Decision needed in §5. |  |
| Typefully | YouTube Channel OS (rec), Twitter/X Growth Machine (rec) — **2 uses** | no | `typefully` | API_KEY | **Resolve orphan → Add via Composio** | Composio **does** publish this toolkit (5 tools, API_KEY). PR4's blanket removal missed this one. Re-add via Composio — cheapest path. |  |
| WordPress | SEO Empire Builder (rec) — **1 use** | no (removed PR4) | — | n/a | **Resolve orphan** | PR4 removed. Composio has no matching toolkit. Decision needed in §5. |  |

### Add via Composio (15 — composioToolkitId confirmed in dumped list)

| Tool | Templates using it | In catalog? | Composio toolkit ID | Auth type | Recommended action | Notes | Operator decision |
|---|---|---|---|---|---|---|---|
| DocuSign | Law Firm Intake OS (rec) — **1 use** | no | `docusign` | OAUTH2 | Add via Composio | 335 tools. |  |
| Follow Up Boss | Real Estate Agent OS (rec) — **1 use** | no | `follow_up_boss` | API_KEY, OAUTH2 | Add via Composio | 99 tools. |  |
| FreshBooks | Freelancer Revenue Engine (rec) — **1 use** | no | `freshbooks` | OAUTH2 | Add via Composio | 10 tools. |  |
| GitLab | Developer Productivity OS (req, compound "GitHub or GitLab") — **1 use** | no | `gitlab` | OAUTH2 | Add via Composio | 58 tools. Splits compound into `{ oneOf: ["github", "gitlab"] }`. |  |
| Google Ads | E-Commerce Profit Maximizer (rec) — **1 use** | no | `googleads` | OAUTH2 | Add via Composio | 9 tools. |  |
| Google Docs | Student Accelerator (rec), Job Hunter OS (rec) — **2 uses** | no | `googledocs` | OAUTH2 | Add via Composio | 33 tools. |  |
| Harvest | Agency Operations OS (rec) — **1 use** | no | `harvest` | OAUTH2 | Add via Composio | 57 tools. |  |
| JotForm | Law Firm Intake OS (rec) — **1 use** | no | `jotform` | API_KEY | Add via Composio | 18 tools. |  |
| Lever | Recruiter OS (rec) — **1 use** | no | `lever` | API_KEY, OAUTH2 | Add via Composio | 64 tools. |  |
| Meta Ads | E-Commerce Profit Maximizer (rec) — **1 use** | no | `metaads` | OAUTH2, API_KEY | Add via Composio | 50 tools. |  |
| Outlook | Founder's Chief of Staff (req, compound "Gmail or Outlook") — **1 use** | no | `outlook` | OAUTH2, S2S_OAUTH2 | Add via Composio | 282 tools. Splits compound into `{ oneOf: ["gmail", "outlook"] }`. |  |
| QuickBooks | Agency Operations OS (rec) — **1 use** | no | `quickbooks` | OAUTH2 | Add via Composio | 105 tools. |  |
| Toggl | Agency Operations OS (rec) — **1 use** | no | `toggl` | API_KEY | Add via Composio | 56 tools. |  |
| Typeform | Law Firm Intake OS (rec) — **1 use** | no | `typeform` | OAUTH2 | Add via Composio | 35 tools. |  |
| Webflow | SEO Empire Builder (rec) — **1 use** | no | `webflow` | OAUTH2, API_KEY | Add via Composio | 51 tools. |  |

### Add as direct integration (0 non-flagged — all candidates require operator decision, see §5)

No "Add as direct" recommendations I can make unilaterally. Every candidate that's missing from both catalog and Composio falls into one of these operator-decision buckets (§5):
- Vertical-specific APIs with public REST (Greenhouse, Bullhorn, Clio, MyCase, ServiceTitan, Housecall Pro, Snyk, DrChrono, Keepa, Zillow, Google Business Profile, Amazon SP-API, Kraken API, Upwork API, SparkLoop, TubeBuddy)
- Products without public server APIs (Apple Health, Google Fit — deprecated Oct 2025, MLS/IDX feed, Dentrix, Athena, Substack)

### Drop from template (0 non-flagged — all flagged in §5)

Per audit rule ("Do not silently propose `Drop from template`"), every drop candidate is deferred to §5 for operator decision.

### Already correct (59 rows — omitted for brevity, full list in per-atom breakdown)

Every atom where the catalog resolution works today (directly, via alias, or via substring matcher that happens to hit the right slug). Full list:

`Ahrefs` · `Alpaca API` · `Apollo.io` · `Asana` · `Beehiiv` · `Binance API` · `Calendly` · `Claude API` (via alias → `anthropic_api`) · `Clay.com` · `ClickUp` · `ConvertKit` · `Gmail` · `Google Analytics` · `Google Calendar` · `Google Search Console` · `HubSpot` · `Instantly.ai` · `Jira` · `Linear` · `LinkedIn` · `Notion` · `Polymarket API` · `Salesforce` · `SEMrush` · `Shopify` · `Slack` · `Stripe` · `Tavily` · `Twilio` · `Twitter API` (via alias → `twitter-api`) · `Twitter/X API` · `VidIQ` · `YouTube Data API`

Plus these pure substring / exact-name resolutions (no alias needed):
`GitHub` (direct) · `HIPAA-compliant SMS (Twilio BAA)` (substring → `twilio`; §5 flags renaming) · `Calendar` (substring → `google_calendar`; §5 flags ambiguity)

**Remaining bucket — flagged operator decisions** — see Section 5. Count: 23 atoms.

---

## Section 4 — Phase B preview

### Catalog entries to add (15–16)

Minimum set assuming all "Add via Composio" rows are accepted:
1. `typefully` (OAUTH_COMPOSIO, composioToolkitId=`typefully`, auth API_KEY per Composio)
2. `docusign` (OAUTH_COMPOSIO, `docusign`)
3. `follow_up_boss` (hybrid — direct field in the catalog, API_KEY + OAUTH2 exposed via Composio)
4. `freshbooks` (OAUTH_COMPOSIO, `freshbooks`)
5. `gitlab` (OAUTH_COMPOSIO, `gitlab`)
6. `googleads` (OAUTH_COMPOSIO, `googleads`)
7. `googledocs` (OAUTH_COMPOSIO, `googledocs`)
8. `harvest` (OAUTH_COMPOSIO, `harvest`)
9. `jotform` (OAUTH_COMPOSIO or API_KEY — Composio lists API_KEY)
10. `lever` (hybrid)
11. `metaads` (hybrid)
12. `outlook` (OAUTH_COMPOSIO, `outlook`)
13. `quickbooks` (OAUTH_COMPOSIO, `quickbooks`)
14. `toggl` (OAUTH_COMPOSIO or API_KEY)
15. `typeform` (OAUTH_COMPOSIO, `typeform`)
16. `webflow` (hybrid)

### Template files to edit

`src/data/claw-templates.ts`:
- **Compound string conversions (5)** — replace string with `{ oneOf: [...] }`:
  - Quant Trader: no change (no compound in required)
  - E-Commerce Profit Maximizer: `"Shopify or Amazon SP-API"` → depends on §5 decision for Amazon SP-API
  - Newsletter Empire: `"Beehiiv or Substack or ConvertKit"` → `{ oneOf: ["beehiiv-api", "convertkit"] }` (drops Substack unless §5 says keep)
  - Agency Operations OS: `"Linear or Asana or ClickUp"` → `{ oneOf: ["linear", "asana", "clickup"] }`
  - Founder's Chief of Staff: `"Gmail or Outlook"` → `{ oneOf: ["gmail", "outlook"] }` (requires `outlook` catalog entry first)
  - Developer Productivity OS: `"GitHub or GitLab"` → `{ oneOf: ["github", "gitlab"] }` (requires `gitlab` catalog entry first)
- **Non-tool drops (2)** — pending §5 decision:
  - Medical Practice Manager: `"HIPAA-compliant SMS (Twilio BAA)"` → `"twilio"` + description note
  - Real Estate Agent OS: `"MLS/IDX feed"` → removed from `recommendedTools`
- **Display-name → slug migration** for every other entry (required once typed slugs land).

`src/data/__tests__/tool-catalog-aliases.test.ts`: delete once templates use slugs (the map itself goes away).

`src/data/tool-catalog.ts`: add `ALL_TOOL_SLUGS` and `ToolSlug` exports; remove `TOOL_NAME_ALIASES`; remove substring branch of `getToolByName` (function can stay as a thin wrapper over `getToolBySlug`, or be removed outright).

### Schema changes required

1. **Typed slug union** in `tool-catalog.ts` (additive).
2. **`oneOf` variant** on `requiredTools` / `recommendedTools` item type in `claw-templates.ts` (breaking at the type level, not at runtime — existing callers that read `tool.required` need to check for `oneOf`).
3. **Setup wizard (`src/app/setup/[workspaceId]/step/[n]/page.tsx:414-495`)** needs a new branch: if the entry is `{ oneOf: [...] }`, render a "Choose one" UI (radio group or tab strip) rather than a single-tool row. Render should pick a default (first option already connected in DB, else first in list).
4. **Connection resolution**: `getToolByName` → `getToolBySlug` switch for the single production call site. Browse-tools modal already uses slug directly; no changes there.

### Risk callouts

1. **Tool icons for new entries**: 15 new catalog entries need icon assets. Composio provides logos (`meta.logo` URL) — we can proxy or mirror. No blocker; just needs a choice between "proxy at runtime" or "copy once + self-host".
2. **Setup wizard `oneOf` rendering**: UX design decision. Current wizard has no "pick one" affordance. Compound strings currently render as a single entry that substring-resolves to one backing tool, hiding the choice from users. After PR2.8, users see the choice explicitly — that's a UX improvement but also a behavior change.
3. **Migration impact on existing workspaces**: `ToolConnection` rows store `toolSlug` directly, no name strings. So existing connections are slug-indexed and unaffected. The only caller that uses display names is `buildToolState` in the setup wizard during template-instantiation-time — one-way flow.
4. **Composio auth-config pre-flight**: Before adding a new `OAUTH_COMPOSIO` entry we should verify the Composio toolkit has a usable default auth config on our account (tracked in `docs/COMPOSIO_RUNTIME_CONTRACT.md`). For 15 new entries, that's 15 pre-flight checks — can be batched.
5. **Cascade from dropping tools**: if §5 says drop some recommended tools, any seed skills referencing those slugs (see `KNOWN_ORPHAN_COMPATIBLE_TOOLS` in `src/data/__tests__/tool-catalog-slug-drift.test.ts`) also need cleanup. Current known orphans: `pipedrive`, `smartlead`, `typefully`, `coinbase`, `snyk`, `zillow`, `google-business-profile`.
6. **Tavily dual-integration risk**: Tavily is in catalog as direct API_KEY, and also on Composio (5 tools, API_KEY). Per parallel-path precedent of `beehiiv-api`/`beehiiv` and `salesforce-api`/`salesforce`, both could coexist. §5 flags this as a decision.
7. **YouTube Data API dual-integration risk**: Catalog has `youtube-data-api` (API_KEY direct). Composio has `youtube` (OAUTH2, 47 tools). Functionally different products/auths. §5 flags.
8. **Coinbase disambiguation**: Catalog has `coinbase` (name "Coinbase Exchange", 3-field API_KEY). Composio has `coinbase` (28 tools). Same slug but possibly different products. "Coinbase API" template atom doesn't substring-match the catalog's "Coinbase Exchange" name. §5 flags.

---

## Section 5 — Open questions for operator

### Q1 — PR4 orphans requiring decision

Buffer (4 template uses) and WordPress (1 use) are absent from both the catalog and Composio. Options per tool:
- **A.** Drop from templates entirely. Simplest.
- **B.** Build as direct integration (both have public REST APIs). Cost: two new API-key-style entries with custom validators.
- **C.** Leave in templates; defensive modal from PR2.7 shows "not connectable yet" message.

Operator picks one per tool.

### Q2 — Vertical tools with real APIs but not on Composio (15 candidates)

Each has a public REST API but no Composio toolkit. All are in recommendedTools (never required).

| Tool | Use count | Has public REST? | Operator choice |
|---|---|---|---|
| Amazon SP-API | 1 (req, in compound "Shopify or Amazon SP-API") | Yes | Add direct / drop from compound / keep compound without matching slug |
| Athena (medical) | 1 | Ambiguous — "Athena" could be Athenahealth (OAuth+TLS) or another | Drop / disambiguate + add |
| Bullhorn | 1 | Yes (OAuth) | Add direct / drop |
| Clio | 1 | Yes (OAuth) | Add direct / drop |
| Dentrix | 1 | No public REST (Windows-only integrations) | Recommend drop |
| DrChrono | 1 | Yes (OAuth) | Add direct / drop |
| Google Business Profile | 3 | Yes (OAuth) | Add direct (high usage) / drop |
| Greenhouse | 1 | Yes (API key) | Add direct / drop |
| Housecall Pro | 1 | Yes (OAuth) | Add direct / drop |
| Keepa | 1 | Yes (API key, paid tier only) | Add direct / drop |
| Kraken API | 1 (rec) | Yes (API key+secret, like Binance) | Add direct / drop |
| MyCase | 1 | Yes (OAuth) | Add direct / drop |
| ServiceTitan | 1 | Yes (OAuth) | Add direct / drop |
| Snyk | 1 | Yes (API key) | Add direct / drop |
| SparkLoop | 1 | Yes (API key) | Add direct / drop |
| TubeBuddy | 1 | No public API | Recommend drop |
| Upwork API | 1 | Limited (closed partner program) | Recommend drop |
| Zillow API | 1 | Limited (restricted) | Recommend drop |

### Q3 — Products without viable server APIs

- **Apple Health** (Health & Fitness Commander, rec) — iOS client-only; no server API. Recommend **drop**.
- **Google Fit** (Health & Fitness Commander, rec) — deprecated by Google (retirement announced). Recommend **drop** or replace with "Health Connect" if we want to add Android Health integration.
- **MLS/IDX feed** (Real Estate Agent OS, rec) — descriptive placeholder, not a product. Recommend **drop** and move intent to template description.
- **Substack** (Newsletter Empire, req, part of compound) — no public writer-facing API; only reader feeds. Recommend **drop from the compound** (leaves `{ oneOf: ["beehiiv-api", "convertkit"] }`).

### Q4 — Compound-string decision: "HIPAA-compliant SMS (Twilio BAA)"

Currently resolves to `twilio` via substring. Three interpretations:
- **A.** Pure descriptive text; replace with `twilio` slug and move HIPAA/BAA note to template `description`.
- **B.** Semantically distinct — HIPAA BAA requires a different Twilio subaccount config, which could warrant a separate `twilio-hipaa` catalog entry.
- **C.** Drop entirely; HIPAA-safe messaging is vendor-agnostic; let operator pick Twilio or any alternative.

### Q5 — Calendar ambiguity

The atom `"Calendar"` appears 11 times across templates. Currently resolves to `google_calendar` via substring. Options:
- **A.** Keep current behavior — "Calendar" means "Google Calendar" implicitly.
- **B.** Promote to `{ oneOf: ["google_calendar", "outlook", "apple_calendar_icloud?"] }` — lets users pick.
- **C.** Require explicit provider in templates: replace "Calendar" with `google_calendar` directly, note alternatives in description.

Option C is the cleanest type-level migration.

### Q6 — Dual-integration policy (existing parallel entries)

We already have `beehiiv-api` + `beehiiv` (removed) and `salesforce-api` + `salesforce`. For the new add-via-Composio set, any ambiguous dual-path tools:

- **Tavily** — catalog has API_KEY direct; Composio offers a 5-tool toolkit. Keep both? Drop Composio? Drop direct?
- **YouTube Data API** — catalog has `youtube-data-api` (API_KEY); Composio has `youtube` (OAUTH2, 47 tools). Different products technically. Keep both, or deprecate one?
- **Coinbase** — catalog has `coinbase` (= Coinbase Exchange, 3-field API_KEY); Composio has `coinbase` (28 tools, API_KEY, likely Coinbase Commerce/Pro). Slug collision risk if we add Composio version without renaming.
- **Shopify** — catalog has `shopify` (OAUTH); Composio has `shopify` (supports API_KEY, OAUTH2, S2S_OAUTH2 with 361 tools). Current catalog already uses Composio OAuth. No action if Composio supports same toolkit.
- **Stripe** — catalog has `stripe_api` (API_KEY); Composio has `stripe` (API_KEY/OAUTH2, 415 tools). Operator picks.

### Q7 — Icon sourcing policy

15+ new catalog entries need icons. Two options:
- **Proxy Composio URLs** — cheap, dynamic, but exposes a runtime dep on Composio's CDN for UI asset.
- **Self-host** — one-time fetch + commit to `public/tool-icons/<slug>.svg`. Safer for production but adds asset files and a refresh cadence.

### Q8 — Migration strategy for templates

Two paths to typed slugs:
- **A. Single PR (PR2.8):** add catalog entries + switch templates to typed slugs + add `oneOf` schema + update setup wizard in one PR. Larger diff, atomic.
- **B. Multi-PR:** PR2.8a (add catalog entries), PR2.8b (typed slugs schema), PR2.8c (setup wizard `oneOf` UI). Smaller diffs, staged.

Recommendation: **B** if wizard UI decision in Q7/§4-risk-2 takes UX review; **A** if we're confident in the default wizard UX.

### Q9 — Expected total `ToolSlug` union size

After Phase B adds the Add-via-Composio set and resolves orphans/§5, catalog will be ~46 + 15 = **61** entries, give or take the orphan and Q2/Q3 decisions. Worth confirming this scale is acceptable from a catalog-management perspective (vs e.g., gating on a provider-managed registry).

---

## Acceptance checklist (for operator)

Before Phase B begins:
- [ ] Q1 decisions recorded inline in §3 orphan rows (Buffer, WordPress)
- [ ] Q2 decisions recorded inline in §3 (one line per vertical tool)
- [ ] Q3 confirmed: drop Apple Health, Google Fit, MLS/IDX feed, Substack
- [ ] Q4 picked (A/B/C for HIPAA-compliant SMS)
- [ ] Q5 picked (A/B/C for Calendar)
- [ ] Q6 picked per dual-integration tool (Tavily, YouTube, Coinbase, Shopify, Stripe)
- [ ] Q7 picked (proxy vs self-host icons)
- [ ] Q8 picked (single PR vs staged)
- [ ] Any additional tools to add (not already flagged) noted in §3 Operator decision column

---

**Audit artifacts (all gitignored, safe to delete after Phase B):**
- `tmp/list-composio-toolkits.mjs` — paginated Composio toolkit fetcher
- `tmp/composio-toolkits.txt` — human-readable slug/name/auth list (1030 entries)
- `tmp/composio-toolkits.json` — machine-readable same data
- `tmp/cross-reference.mjs` — atom-by-atom cross-ref script
- `tmp/cross-reference.txt` — generated cross-reference output (used to build §3)

**To reproduce the audit:**
```bash
node tmp/list-composio-toolkits.mjs       # needs COMPOSIO_API_KEY in .env.local/.env.staging
node tmp/cross-reference.mjs > tmp/cross-reference.txt
```
