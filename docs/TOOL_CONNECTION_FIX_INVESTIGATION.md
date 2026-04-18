# Tool Connection Fix — Investigation

**Status:** Read-only analysis. No code changes in this PR.
**Companion doc:** [TOOL_CONNECTION_GENERATOR_BUG.md](./TOOL_CONNECTION_GENERATOR_BUG.md) — the bug report that triggered this investigation.
**Purpose:** Enumerate the tool/skill data model, evaluate three schema options for the fix, make a recommendation, and surface the open product decisions that block the fix PR.

---

## 1. Current state summary

### The broken functions

Two functions in [src/lib/openclaw/generator.ts](../src/lib/openclaw/generator.ts):

- `generateSkillsEntriesConfig` (lines 373–399) — builds `openclaw.json → skills.entries`.
- `generateToolsMd` (lines 996–1028) — renders `TOOLS.md`.

Both read four fields that do not exist on the Prisma `ToolConnection` model:

| Phantom field      | Used in                          | Intent                                            |
|--------------------|----------------------------------|---------------------------------------------------|
| `toolConn.skillSlug`     | `generateSkillsEntriesConfig` | Keys the `skills.entries` map.                    |
| `toolConn.envVarMapping` | `generateSkillsEntriesConfig` | `Record<envName, encryptedValue>` for the skill.  |
| `toolConn.toolName`      | `generateToolsMd`             | Display name for the `### heading` in TOOLS.md.   |
| `toolConn.notes`         | `generateToolsMd`             | Free-text notes under each tool section.          |

### Why it was invisible

1. **`@ts-nocheck`** at [generator.ts:1](../src/lib/openclaw/generator.ts#L1) suppresses the four property-does-not-exist errors tsc would raise.
2. **Mock drift.** The integration test at [generator.test.ts:111–119](../src/lib/openclaw/__tests__/generator.test.ts#L111) constructs a `toolConnections` record with exactly these phantom fields, so the test passes against a shape production cannot produce.

### Runtime consequences (what happens in prod)

- `generateSkillsEntriesConfig`: the early `if (!toolConn.skillSlug) continue` fires for every row, so `entries` is always `{}`.
  - Generator side-effect (at [generator.ts:298–300](../src/lib/openclaw/generator.ts#L298)): `if (Object.keys(skillsEntries).length > 0) config.skills = { entries: skillsEntries };` — when `entries` is empty, `config.skills` is never set, so the container has no `skills.entries` block at all.
- `generateToolsMd`: the header string becomes `### undefined`, and `connectionType` is the only truthful field that prints.
- Net effect: every user who wires up Tavily, HubSpot, Salesforce, etc. ends up with a container that reports "Connected" in our UI but never receives the credentials at runtime. Agent tool calls fail silently.

### Actual `ToolConnection` fields

From [prisma/schema.prisma:425–450](../prisma/schema.prisma#L425):

```prisma
model ToolConnection {
  id                   String   @id @default(cuid())
  workspaceId          String
  toolSlug             String                       // e.g. "tavily"
  connectionType       ConnectionType               // API_KEY | OAUTH_COMPOSIO | CHANNEL_NATIVE
  displayName          String                       // e.g. "My Tavily key"
  encryptedApiKey      String?
  keyHint              String?                      // e.g. "tvly-****abc1"
  composioConnectionId String?
  composioEntityId     String?
  status               ToolConnectionStatus         // PENDING | CONNECTED | EXPIRED | ERROR | REVOKED
  lastTestedAt         DateTime?
  lastError            String?
  @@unique([workspaceId, toolSlug])
}
```

No `skillSlug`. No `envVarMapping`. No `toolName` (it's `displayName`). No `notes`.

---

## 2. Tool universe

### Static registry: [src/data/tool-catalog.ts](../src/data/tool-catalog.ts)

47 tools. Each entry has `slug`, `name`, `connectionType`, `category`, optional `helpUrl`, `keyPlaceholder`, `composioToolkitId`, `description`, `isAIProvider`.

**No `skillSlug` or `envVars` fields exist on `ToolDefinition` today.**

**API_KEY tools (26):**

| slug           | name                   | category       |
|----------------|------------------------|----------------|
| `anthropic_api`  | Anthropic (Claude)   | AI             |
| `tavily`         | Tavily               | SEARCH         |
| `serp_api`       | SerpAPI              | SEARCH         |
| `exa_search`     | Exa                  | SEARCH         |
| `brave_search`   | Brave Search         | SEARCH         |
| `apollo`         | Apollo.io            | LEAD_DATABASE  |
| `clay`           | Clay.com             | LEAD_DATABASE  |
| `instantly`      | Instantly.ai         | EMAIL          |
| `sendgrid`       | SendGrid             | EMAIL          |
| `mailgun`        | Mailgun              | EMAIL          |
| `cal_com`        | Cal.com              | CALENDAR       |
| `stripe_api`     | Stripe               | PAYMENTS       |
| `polymarket`     | Polymarket           | TRADING        |
| `binance`        | Binance              | TRADING        |
| `alpaca`         | Alpaca               | TRADING        |
| `youtube_data`   | YouTube Data API     | SOCIAL         |
| `twitter_api`    | Twitter/X API        | SOCIAL         |
| `gsc`            | Google Search Console| SEO            |
| `ahrefs`         | Ahrefs               | SEO            |
| `semrush`        | SEMrush              | SEO            |
| `twilio`         | Twilio               | SMS            |
| `posthog`        | PostHog              | ANALYTICS      |
| `mixpanel`       | Mixpanel             | ANALYTICS      |
| `elevenlabs`     | ElevenLabs           | VOICE          |
| `stabilityai`    | Stability AI         | IMAGES         |
| `vidiq`          | VidIQ                | SOCIAL         |

**OAUTH_COMPOSIO tools (21):**

| slug              | name             | composioToolkitId |
|-------------------|------------------|-------------------|
| `hubspot`         | HubSpot          | `hubspot`         |
| `salesforce`      | Salesforce       | `salesforce`      |
| `gmail`           | Gmail            | `gmail`           |
| `google_calendar` | Google Calendar  | `google_calendar` |
| `google_analytics`| Google Analytics | `google_analytics`|
| `slack`           | Slack            | `slack`           |
| `github`          | GitHub           | `github`          |
| `buffer`          | Buffer           | `buffer`          |
| `linear`          | Linear           | `linear`          |
| `asana`           | Asana            | `asana`           |
| `clickup`         | ClickUp          | `clickup`         |
| `notion`          | Notion           | `notion`          |
| `linkedin`        | LinkedIn         | `linkedin`        |
| `twitter`         | Twitter/X        | `twitter`         |
| `beehiiv`         | Beehiiv          | `beehiiv`         |
| `substack`        | Substack         | `substack`        |
| `convertkit`      | ConvertKit       | `convertkit`      |
| `shopify`         | Shopify          | `shopify`         |
| `wordpress`       | WordPress        | `wordpress`       |
| `jira`            | Jira             | `jira`            |
| `calendly`        | Calendly         | `calendly`        |

### Dynamic registry

[src/app/api/tools/[workspaceId]/browse/route.ts](../src/app/api/tools/[workspaceId]/browse/route.ts) merges additional Composio toolkits at runtime when `COMPOSIO_API_KEY` is set. Count is unbounded and out of our control. These toolkits inherit `connectionType: OAUTH_COMPOSIO`.

### Slug-naming drift (real, blocking)

Cross-referencing [prisma/seed-data/skills-tool-specific.ts](../prisma/seed-data/skills-tool-specific.ts) `compatibleTools` against the catalog:

| Skill's `compatibleTools` value | Catalog slug         | Verdict                          |
|---------------------------------|----------------------|----------------------------------|
| `twitter-api`                   | `twitter_api`        | Mismatch (dash vs underscore)    |
| `youtube-data-api`              | `youtube_data`       | Mismatch (dash vs underscore, different name) |
| `google-search-console`         | `gsc`                | Mismatch (entirely different token) |
| `google-analytics`              | `google_analytics`   | Mismatch (dash vs underscore)    |
| `pipedrive`, `smartlead`, `typefully`, `coinbase`, `snyk`, `zillow`, `google-business-profile` | — | Not in catalog at all |

This matters because **any fix that uses `Skill.compatibleTools` for the tool→skill map must either normalize slugs or fix the seed data first**, otherwise a user connecting Twitter/X API (catalog slug `twitter_api`) would not get the `twitter-api` skill matched — exactly the same silent failure we're trying to fix.

---

## 3. Skills universe

Three distinct storage layers, all labelled "skill":

### A. `Skill` table (built-in / curated)

[prisma/schema.prisma:321–352](../prisma/schema.prisma#L321):

```prisma
model Skill {
  id, name, slug, description
  skillMd                 String     @db.Text
  type                    SkillType  // BUILT_IN | TOOL_SPECIFIC | TOOL_AGNOSTIC | DOMAIN_WORKFLOW | USER_GENERATED
  category                SkillCategory
  compatibleTools         String[]   // <-- the tool→skill map, today
  requiresToolConnection  Boolean
  requiredToolCategory    String?
  permissions             String[]
  isBuiltIn, isVerified, isCurated, version
  agentSkills             AgentSkill[]
}
```

Seeded from four files under [prisma/seed-data/](../prisma/seed-data/) (`skills-tool-specific.ts`, `skills-tool-agnostic.ts`, `skills-domain-workflow.ts`, `skills-builtin.ts`). The `AgentSkill` join table is how the Builder associates an agent with a skill.

**No `requiredEnvVars` on this model.** The env-var requirements are implicit in the `skillMd` body.

### B. `MarketplaceSkill` table (creator-uploaded)

[prisma/schema.prisma:856–906](../prisma/schema.prisma#L856):

```prisma
model MarketplaceSkill {
  slug, name, description, category, tags, emoji
  skillMd          String   @db.Text
  requiredBins     String[]          // e.g. ["curl", "jq"]
  requiredEnvVars  String[]          // <-- explicit, e.g. ["HUBSPOT_API_KEY"]
  creator, trustTier, reviewStatus, ...
}
```

This table **does** declare env vars explicitly. Examples from [marketplace-skills.ts](../prisma/seed-data/marketplace-skills.ts):

- `hubspot-crm` → `["HUBSPOT_API_KEY"]`
- `salesforce-crm` → `["SALESFORCE_TOKEN"]`
- `twitter-api` → `["TWITTER_BEARER_TOKEN"]`

These are **tool-specific env var names**, not the generic `$TOOL_API_KEY` used by the built-in skills. Two conventions in the same codebase.

### C. OpenClaw-bundled skills

[generator.ts:1092](../src/lib/openclaw/generator.ts#L1092) notes:

> `~55 skills are bundled with OpenClaw (weather, github, etc.). We only generate skills for tools specific to the user's connected tools that aren't already bundled.`

We don't have the OpenClaw source locally (no `@openclaw/*` package installed, no vendored gateway), so we cannot enumerate these. The generator currently **does not try** to configure them — it just relies on the gateway loading them from its own image.

### The `$TOOL_API_KEY` convention

Grep of [skills-tool-specific.ts](../prisma/seed-data/skills-tool-specific.ts) returns 84 occurrences of `$TOOL_API_KEY` in `skillMd` bodies. Every TOOL_SPECIFIC built-in skill uses this **generic** placeholder.

The convention (reverse-engineered from the shape of `skillMd` + how OpenClaw scopes env vars per skill): OpenClaw scopes the env block **per-skill entry**, so two skills in the same workspace can both refer to `$TOOL_API_KEY` without collision — each gets the value from its own `skills.entries[slug].env.TOOL_API_KEY`.

**This convention only holds if OpenClaw's runtime per-skill env scoping works as I inferred.** Not verified against OpenClaw source.

### Multi-variable exceptions (known UX gap)

Five built-in skills require a **second** env var that `$TOOL_API_KEY` alone cannot provide, because they need a host + key, or key + secret:

| Skill (`compatibleTools`)    | Second env var    | Purpose                                       |
|------------------------------|-------------------|-----------------------------------------------|
| `salesforce-crm` (`salesforce`) | `$SF_INSTANCE_URL`| Per-org Salesforce API host                    |
| `beehiiv` (`beehiiv`)           | `$BEEHIIV_PUB_ID` | Publication ID embedded in every API call     |
| `binance` (`binance`)           | `$BINANCE_SECRET` | HMAC-SHA256 signing secret                    |
| `coinbase` (`coinbase`)         | `$CB_API_SECRET`  | Same: signing secret                          |
| `alpaca` (`alpaca`)             | `$ALPACA_SECRET`  | Trading API secret                            |

**The Setup Wizard only captures a single API key per connection today.** These five tools are **already broken** for a reason different from the primary bug — even if we fix the primary bug, the second variable is never asked for, never stored, never emitted. This is a pre-existing UX gap that any schema decision should acknowledge.

---

## 4. OpenClaw's expected `skills.entries` schema (inferred, unverified)

No `@openclaw/*` package in `package.json`. No vendored source under `container/` or similar. The only local signals are:

- [generator.ts:188–194](../src/lib/openclaw/generator.ts#L188) comment: `openclaw.json is STRICTLY VALIDATED by OpenClaw's Zod schema. .strict() objects: unknown keys cause validation failure`.
- The generator's own emitted shape before it broke: `{ enabled: true, env: Record<string, string> }`.

**Inferred** minimal shape:

```json
{
  "skills": {
    "entries": {
      "<skill-slug>": {
        "enabled": true,
        "env": { "TOOL_API_KEY": "<decrypted value>" }
      }
    }
  }
}
```

**Unknowns** (that `.strict()` would reject if we guess wrong):

- Whether OpenClaw accepts keys other than `enabled` and `env` in an entry (e.g. `disabledReason`, `timeout`, `args`, `bin`).
- Whether empty `env: {}` is valid, or whether `env` should be omitted when there are no variables (relevant for OAUTH_COMPOSIO tools where Composio handles auth out-of-band).
- Whether skill slugs in `skills.entries` must match the OpenClaw-bundled skill's slug exactly, or whether user-defined slugs are allowed.
- Whether there's a top-level `skills.enabled: boolean` or similar.

**I recommend emitting only `enabled` and `env` until we have the gateway's schema in hand** — the cost of being wrong is runtime validation failure at deploy, which is better than the current silent failure but still painful.

---

## 5. Three options, fully evaluated

### Option A — In-code registry, skill-centric (minimal change)

**Data:**

- Tool metadata stays in [src/data/tool-catalog.ts](../src/data/tool-catalog.ts). Optionally extend `ToolDefinition` with `envVarNameOverride?: string` (defaults to `"TOOL_API_KEY"`).
- Tool→skill map comes from `Skill.compatibleTools: String[]` (already populated and seeded).
- Env var name comes from the `$TOOL_API_KEY` convention, hardcoded in generator as `"TOOL_API_KEY"` (or read from `envVarNameOverride` if ever set).

**Generator rewrite:**

```ts
for (const toolConn of workspace.toolConnections) {
  if (toolConn.status !== 'CONNECTED') continue;
  if (toolConn.connectionType === 'OAUTH_COMPOSIO') continue; // see open question #1
  if (!toolConn.encryptedApiKey) continue;
  const decryptedKey = decrypt(toolConn.encryptedApiKey);
  const skills = await prisma.skill.findMany({
    where: { compatibleTools: { has: toolConn.toolSlug } },
  });
  for (const skill of skills) {
    entries[skill.slug] = {
      enabled: true,
      env: { TOOL_API_KEY: decryptedKey },
    };
  }
}
```

TOOLS.md gets `displayName` (exists on the model) with a fallback to `getToolBySlug(toolSlug)?.name`.

| Dimension                     | Verdict                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| Setup Wizard discovery        | Unchanged; already reads `tool-catalog.ts`.                             |
| Generator path                | `ToolConnection.toolSlug` → `Skill.compatibleTools` → `skills.entries[skill.slug]`. |
| Tool removal                  | Remove from `tool-catalog.ts` + seed. Orphaned `ToolConnection` rows become no-ops. |
| Marketplace interaction       | Out of scope today (Builder only wires up `Skill`, not `MarketplaceSkill`). |
| Migration path                | **Zero.** No DB changes, no user reconnection, no backfill.              |
| Multi-var tools               | Still broken (primary key works; `$SF_INSTANCE_URL` etc. missing).       |
| Slug drift                    | Blocks ~5 tools (Twitter API, YouTube Data, GSC, Google Analytics) unless we normalize or fix seeds. |

### Option B — Denormalize into `ToolConnection`

**Schema migration:**

```prisma
model ToolConnection {
  // existing...
  skillSlug       String?   // breaks 1:N (one tool can drive multiple skills)
  envVarsJson     Json?     // { ENV_NAME: encryptedValue }
  description     String?
}
```

**Generator:** reads `envVarsJson` directly, decrypts, emits into `skills.entries[skillSlug].env`.

| Dimension                     | Verdict                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| Setup Wizard                  | Needs new UI fields for multi-var tools (captures `envVarsJson`).        |
| Generator path                | `ToolConnection.skillSlug` + `envVarsJson` directly. Simple read, no joins. |
| Tool removal                  | Orphaned rows where `skillSlug` points to removed skill — cleanup job needed. |
| Marketplace                   | Marketplace skills would need the same storage; duplicate or unify.      |
| Migration path                | Prisma migration. Existing rows get `skillSlug = NULL`, `envVarsJson = NULL` — effectively **forces every user to reconnect every tool**. Backfill impossible because no mapping was ever persisted. |
| Multi-var tools               | **Solved** — the schema now supports it.                                |
| Slug drift                    | Doesn't help directly; still a concern if UI passes the wrong slug.     |

**Advantage:** properly models multi-variable tools.
**Cost:** migration, UI work, existing users must reconnect, and we still need a separate registry for Setup Wizard.

### Option C — Separate `Tool` model

**Schema migration:**

```prisma
model Tool {
  slug            String  @id
  displayName     String
  description     String?
  connectionType  ConnectionType
  category        String
  skillSlug       String                   // FK-ish to Skill.slug
  envVars         String[]                 // NAMES ONLY, e.g. ["TOOL_API_KEY", "SF_INSTANCE_URL"]
}

model ToolConnection {
  // existing + FK on toolSlug -> Tool.slug
}
```

Tool metadata moves into the DB. [src/data/tool-catalog.ts](../src/data/tool-catalog.ts) becomes a seed file or is deleted.

| Dimension                     | Verdict                                                                 |
|-------------------------------|-------------------------------------------------------------------------|
| Setup Wizard                  | Queries `Tool` table (instead of importing the catalog). Marginally slower, but cacheable. |
| Generator path                | `ToolConnection` → `Tool` → `Skill`. Clean joins.                        |
| Tool removal                  | Cascade rules or soft delete.                                           |
| Marketplace                   | Cleanly normalized; marketplace skills can reference `Tool.slug` too.    |
| Migration path                | New table, seed 47 tools, add FK, write migration. One-time.            |
| Multi-var tools               | **Solved** via `Tool.envVars: String[]`. UI still needs to capture values, but schema is ready. |
| Slug drift                    | Tool table becomes the single source of truth. Seed step can enforce consistency. |

**Advantage:** proper normalization, future-proof.
**Cost:** meaningful DB work for 47 static items. Any tool-catalog edit becomes a seed sync. Most of the value vs Option B is aesthetic.

---

## 6. Recommendation: **Option A, with five specific constraints**

1. **Keep [tool-catalog.ts](../src/data/tool-catalog.ts) as the single source of truth for tool metadata.** No new DB table. No new columns on `ToolConnection`.
2. **Use `Skill.compatibleTools` as the tool→skill map.** It's already populated in the seeds and already read by other parts of the builder.
3. **Hardcode `"TOOL_API_KEY"` as the emitted env var name in `skills.entries[slug].env`.** 84 grep hits across the skill library verify this convention.
4. **Handle the slug drift in the same PR.** Fix the four seed-data mismatches (`twitter-api → twitter_api`, `youtube-data-api → youtube_data`, `google-search-console → gsc`, `google-analytics → google_analytics`). Otherwise Option A ships broken for those four tools.
5. **Ship partial support for multi-var tools** (Salesforce, Beehiiv, Binance, Coinbase, Alpaca). Primary key works. Secondary env var missing. Flag these five in the Setup Wizard with a "Partial support — some features will fail" banner. Track as a follow-up: add multi-input UX + persistence + generator support.

### For OAUTH_COMPOSIO tools (21 of the 47)

**Emit nothing into `skills.entries.env`.** Composio handles auth via `composioConnectionId` stored on the `ToolConnection`. Still emit the skill as `{ enabled: true }` if the user has a connected tool that maps to that skill, so the agent knows the skill is usable.

**This is an inference.** See [open question #1](#7-open-questions) — I can't verify it from local sources.

### Reasoning

- **Smallest blast radius.** No DB migration. No user reconnection. No UI work for the 42 single-var tools.
- **Uses data we already have.** `Skill.compatibleTools`, `ToolConnection.toolSlug`, `ToolConnection.encryptedApiKey`, `ToolConnection.displayName` — all already populated.
- **Honors verified conventions.** `TOOL_API_KEY` is the 84-times-over convention for built-in skills.
- **Testable against real Prisma types.** The integration test can import `Prisma.ToolConnectionGetPayload` and `Prisma.SkillGetPayload` so any future schema change that drops a used field fails at type-check time. This blocks the drift that caused the original bug.
- **Options B and C solve a multi-var UX problem with a schema change, when the real gap is UX.** The UI doesn't ask for `$SF_INSTANCE_URL` today; changing the schema doesn't make the user fill it in. Fix the UX first; the schema can follow.
- **Option C's DB-backed `Tool` registry is the "right" design if we had more tools.** At 47 static tools that change rarely, the cost of seed sync + migrations outweighs the normalization benefit.

### What Option A does NOT fix (call out explicitly)

- **Multi-var tools.** 5 of 47 tools. Known gap. Follow-up PR.
- **OpenClaw-bundled skill interaction.** If OpenClaw's bundled skills expect a different env var name (e.g. `HUBSPOT_API_KEY` for the bundled HubSpot skill), our `TOOL_API_KEY` override may not satisfy them. Needs gateway-side verification.
- **Dynamic Composio toolkits** (from [`/api/tools/.../browse`](../src/app/api/tools/[workspaceId]/browse/route.ts)). These are Composio-mediated (see #1). Option A's OAUTH handling covers them.
- **Marketplace skills.** Installable `MarketplaceSkill` records use `requiredEnvVars` with explicit names (`HUBSPOT_API_KEY`, not `TOOL_API_KEY`). The generator does not currently emit config for marketplace skills. If/when it does, Option A's `TOOL_API_KEY` override will not apply and a different resolver is needed.

---

## 7. Open questions

These five decisions block the fix PR. I need your call before I write any code.

### 1. OAUTH_COMPOSIO tool handling

21 of 47 tools are Composio-mediated (HubSpot, Salesforce, Gmail, Slack, etc.). For these, the `ToolConnection` has a `composioConnectionId` but no API key. The skill's `skillMd` still uses `$TOOL_API_KEY` in its curl examples (we seed it generically), but real auth is supposed to happen through Composio at runtime.

Two possibilities:

- **(a) Composio-native.** OpenClaw reads `composioConnectionId` from the container env and handles OAuth at runtime. We emit `{ enabled: true }` with **no env block** and Composio injects headers into outbound requests. The `$TOOL_API_KEY` in the skillMd becomes harmless prose because Composio replaces the whole transport.
- **(b) Skip entirely.** Users are expected to also have an API key for these tools (Composio is just the OAuth broker), and until we can verify runtime behavior, we omit OAUTH_COMPOSIO tools from `skills.entries` entirely — the skills still exist in the agent's catalog but with no env.

**I cannot verify this from local source.** No OpenClaw package, no Composio docs referenced in our code.

**Proposed default:** (b) — safer. Ship fix for API_KEY tools; track Composio enablement as a follow-up.

**Your call:** (a) or (b)?

### 2. Multi-variable tools (Salesforce, Beehiiv, Binance, Coinbase, Alpaca)

Five tools need a second env var that the Setup Wizard doesn't capture today.

- **(a) Ship partial support now.** Primary key works. Show a "Partial support" badge in the UI. Follow-up PR adds multi-var UX + generator support.
- **(b) Gate the fix.** Block the PR until UI + schema + generator all land together.

**Proposed default:** (a). Fixing the primary path unblocks 42/47 tools immediately. The 5 multi-var tools are already broken today and remain broken after this PR — no net regression, partial progress.

**Your call:** (a) or (b)?

### 3. Slug normalization

Four seed mismatches (`twitter-api`, `youtube-data-api`, `google-search-console`, `google-analytics`) plus seven skills pointing at tools that don't exist in the catalog (`pipedrive`, `smartlead`, `typefully`, `coinbase`, `snyk`, `zillow`, `google-business-profile`).

- **(a) Fix seeds in the fix PR** — align `compatibleTools` values to catalog slugs; delete or reclassify the orphans.
- **(b) Add a slug normalizer in the generator** (strip `-api`/`-data-api`, convert `-` ↔ `_`) — handles the drift without seed changes but is fragile.
- **(c) Separate cleanup PR.**

**Proposed default:** (a). The fix PR already touches the generator and tests; one more seed change is small and gives us a consistent baseline. (b) is brittle; (c) leaves the fix half-broken for 4 tools.

**Your call:** (a), (b), or (c)?

### 4. `@ts-nocheck` removal

[TOOL_CONNECTION_GENERATOR_BUG.md](./TOOL_CONNECTION_GENERATOR_BUG.md) says the directive should come off in the fix PR.

- **(a) Remove in the fix PR.** Force all 4 phantom refs to be corrected before the PR lands.
- **(b) Keep, remove in follow-up.** Smaller diff.

**Proposed default:** (a). The whole reason the bug survived is `@ts-nocheck`. Removing it is what makes the fix durable.

**Your call:** (a) or (b)?

### 5. Test mocks: `Prisma.*GetPayload` vs handwritten object literals

The current test at [generator.test.ts:111](../src/lib/openclaw/__tests__/generator.test.ts#L111) uses handwritten objects. This is what let the drift go undetected.

- **(a) Replace with `Prisma.ToolConnectionGetPayload<{ select: {...} }>`-typed mocks.** Schema changes break tests at type-check time.
- **(b) Keep handwritten mocks.** Simpler to read, but doesn't prevent the class of bug we're fixing.

**Proposed default:** (a), strongly. Without this, the fix is one Prisma migration away from regressing.

**Your call:** (a) or (b)?

---

## Appendix: what happens next

Once you answer the 5 questions, the fix PR will:

1. Rewrite `generateSkillsEntriesConfig` and `generateToolsMd` against the real Prisma model.
2. Apply the four slug fixes in `skills-tool-specific.ts` seed (assuming 3(a)).
3. Remove `@ts-nocheck` from `generator.ts` (assuming 4(a)).
4. Replace test mocks with `Prisma.*GetPayload`-typed shapes (assuming 5(a)).
5. Add an integration test that:
   - Builds a `ToolConnection` row of the real shape.
   - Calls `generateWorkspace`.
   - Asserts `openclaw.json → skills.entries[<skill-slug>].env.TOOL_API_KEY` contains the decrypted key.
   - Asserts `TOOLS.md` contains the tool's `displayName` (no `### undefined`).
6. Not touch multi-var tools (assuming 2(a)).
7. Not touch OAUTH_COMPOSIO env handling (assuming 1(b)).

Estimated scope: ~150 LOC production change, ~100 LOC test, 1 seed-data PR, zero DB migrations.
