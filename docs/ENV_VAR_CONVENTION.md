# Env Var Convention for `skills.entries[slug].env`

> **Status:** Investigation PR — no production code, schema, or seed changes. Produces the decision that blocks PR #2, #3, #5 downstream.
> **Companion doc:** [TOOL_CONNECTION_FIX_INVESTIGATION.md](./TOOL_CONNECTION_FIX_INVESTIGATION.md) — the investigation that previously recommended generic `TOOL_API_KEY`. This PR overturns that recommendation.

---

## TL;DR

**Use named-per-tool env vars (`NOTION_API_KEY`, `GITHUB_TOKEN`, …) sourced from each skill's frontmatter `primaryEnv`. Emit them via `skills.entries[<skill-slug>].apiKey = "<decrypted>"`, not via `skills.entries[<slug>].env`.**

Confidence: **high**. The OpenClaw runtime image contains zero references to `TOOL_API_KEY`; every bundled skill that needs credentials declares its env var name explicitly in YAML frontmatter (e.g. `primaryEnv: "NOTION_API_KEY"`). OpenClaw already handles the "host doesn't know the name, just give it the value" case via the `apiKey` shortcut on skill entries — we don't need a generic placeholder, and inventing one (which our 84 seed hits did) doesn't match runtime behaviour.

The prior `TOOL_API_KEY` recommendation in [TOOL_CONNECTION_FIX_INVESTIGATION.md §6](./TOOL_CONNECTION_FIX_INVESTIGATION.md#6-recommendation-option-a-with-five-specific-constraints) was derived from 84 grep hits inside our own seed file. That seed file was authored **under the broken generator (while `@ts-nocheck` hid the fact that nothing was being emitted)**. The 84 hits reflect a convention we invented, not one OpenClaw honours. No existing deployment is running on the old convention because `skills.entries` has been empty in every generated config — the generator's `if (!toolConn.skillSlug) continue` early-return fires for every row (see [TOOL_CONNECTION_FIX_INVESTIGATION.md §1 "Runtime consequences"](./TOOL_CONNECTION_FIX_INVESTIGATION.md#runtime-consequences-what-happens-in-prod)). So there is zero back-compat cost in flipping.

---

## Provenance (pin everything)

| Artefact | Reference |
|---|---|
| Runtime image | `ghcr.io/laxcorp-research/openclaw-runtime:latest` @ `sha256:9e1af63c16d44066a3d2c66332b3842dd40a17bcaab6a6bada9fd2a172dd9301` |
| Image base | `docker.io/library/node:22-bookworm` (label `org.opencontainers.image.base.digest` = `sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935`) |
| Upstream image source label | `org.opencontainers.image.source=https://github.com/openclaw/openclaw` |
| Image `package.json` version | `2026.3.1-beta.1` (from `/app/package.json` inside the image) |
| Closest upstream source tag | `v2026.3.1` at commit `d76b224e20c790b7223d4075abd087c9576a4661` (the exact `v2026.3.1-beta.1` tag is not published on GitHub; it was either deleted post-GA or built from an unpublished pre-release branch — see "Tag drift" below) |
| Drift baseline | Upstream `main` HEAD `50e71daaa0619fdb88739af2d36d63748bb2e51a`, version `2026.4.16` (pushed 2026-04-17, 1.5 months ahead of our image) |
| Our Dockerfile contribution | `docker/Dockerfile` — `FROM ${BASE_IMAGE}` + two `COPY` lines (`container/process-manager.mjs`, `container/credit-proxy.mjs`). **Zero skill or gateway code added by us.** |

### Tag drift: the image's beta suffix is not pushed upstream

Our image was built from version `2026.3.1-beta.1` but no git tag of that name exists on `github.com/openclaw/openclaw`. The closest match is `v2026.3.1` (`d76b224`). This is a minor provenance gap: the image might have been built from a now-deleted pre-release branch. For the purposes of this investigation it doesn't matter — every relevant piece of evidence (the Zod schema at `src/config/zod-schema.ts:761`, `types.skills.ts`, `env-overrides.ts`, the bundled SKILL.md frontmatter, the `skills.entries` test cases) is identical between the image's rootfs and the `v2026.3.1` source, and identical again in `main` HEAD. The convention has been stable across this span.

### Upstream drift (2026.3.1 vs 2026.4.16)

I checked the `main` HEAD against the pinned image for changes that could affect this recommendation:

| Area | 2026.3.1 (image) | 2026.4.16 (main) | Delta |
|---|---|---|---|
| `SkillConfig` shape (`src/config/types.skills.ts`) | `{ enabled?, apiKey?, env?, config? }` | identical | none |
| `skills.entries[*]` Zod schema (`src/config/zod-schema.ts:761`) | `.strict()` with `enabled | apiKey | env | config` | identical | none |
| `primaryEnv` frontmatter on bundled skills | supported | supported | none |
| `TOOL_API_KEY` references anywhere | 0 | 0 | none |
| Env merge logic (`src/agents/skills/env-overrides.ts`) | globally mutates `process.env`, reverts on return, sanitization allowlist from `primaryEnv + requires.env` | same architecture, adds a reference-count + baseline tracking for multi-agent concurrent skill activation | **non-breaking hardening**, not a convention change |

**Conclusion:** the convention has not shifted in 1.5 months. Safe to recommend without waiting for an image bump. Whatever we ship remains correct when Railway pulls the next `:latest`.

---

## Evidence

### 1. OpenClaw bundled-skill convention (15 skills inspected, image + source cross-checked)

Pulled from both `/app/skills/*/SKILL.md` in the image rootfs (`C:\temp\openclaw-rootfs\skills`) and `skills/*/SKILL.md` in the pinned source clone (`C:\temp\openclaw-src` at `d76b224`). Contents matched byte-for-byte for every file I spot-checked.

| Skill | Path in image | `primaryEnv` (frontmatter) | `requires.env` (frontmatter) | Credential source | Classification |
|---|---|---|---|---|---|
| `notion` | `/app/skills/notion/SKILL.md:8` | `NOTION_API_KEY` | `["NOTION_API_KEY"]` | Named env | **Named (single)** |
| `openai-image-gen` | `/app/skills/openai-image-gen/SKILL.md:11` | `OPENAI_API_KEY` | `["OPENAI_API_KEY"]` | Named env | **Named (single)** |
| `openai-whisper-api` | `/app/skills/openai-whisper-api/SKILL.md:11` | `OPENAI_API_KEY` | `["OPENAI_API_KEY"]` | Named env | **Named (single)** |
| `trello` | `/app/skills/trello/SKILL.md:8` | — | `["TRELLO_API_KEY", "TRELLO_TOKEN"]` | Two named env vars | **Named (multi — 2 vars)** |
| `github` | `/app/skills/github/SKILL.md:4` | — | — | External: `gh` CLI (binary check via `requires.bins: ["gh"]`, auth via `gh auth login`) | **External CLI auth** |
| `gemini` | `/app/skills/gemini/SKILL.md:10` | — | — | External: `gemini` CLI | **External CLI auth** |
| `1password` | `/app/skills/1password/SKILL.md:10` | — | — | External: `op` CLI | **External CLI auth** |
| `spotify-player` | `/app/skills/spotify-player/SKILL.md:10` | — | — | External: `spogo` or `spotify_player` CLI | **External CLI auth** |
| `himalaya` | `/app/skills/himalaya/SKILL.md:10` | — | — | External: `himalaya` CLI (local IMAP/SMTP config) | **External CLI auth** |
| `openhue` | `/app/skills/openhue/SKILL.md:10` | — | — | External: `openhue` CLI (local Hue Bridge) | **External CLI auth** |
| `clawhub` | `/app/skills/clawhub/SKILL.md:8` | — | — | External: `clawhub` npm CLI | **External CLI auth** |
| `slack` | `/app/skills/slack/SKILL.md:4` | — | — | OpenClaw channel config: `channels.slack` | **Channel config** (separate from `skills.entries`) |
| `discord` | `/app/skills/discord/SKILL.md:4` | — | — | OpenClaw channel config: `channels.discord.token` | **Channel config** |
| `weather` | `/app/skills/weather/SKILL.md:5` | — | — | None (public API: wttr.in / Open-Meteo) | **No auth** (control) |
| `feishu-doc` (extension) | `/app/extensions/feishu/skills/feishu-doc/SKILL.md:1` | — | — | Extension-scoped config (`requires: { config: [...] }` elsewhere in extension) | Extension-level |

**Pattern:**

1. Every bundled skill that needs a credential declares it by **name** — either via `primaryEnv: "NAMED_VAR"` (when there's one primary credential) or via `requires.env: ["VAR1", "VAR2"]` (for multi-credential skills like `trello`).
2. Skills that delegate auth to an external CLI (`github` → `gh`, `gemini` → `gemini`, `spotify-player` → `spogo`, etc.) declare zero env vars on their frontmatter. Auth is the CLI's problem, not the skill's.
3. Channel tokens for messaging platforms (Slack, Discord) go through `channels.<platform>` config, **not** through `skills.entries[slug].env`. This is a separate subsystem (see `zod-schema.channels.ts` at the image).
4. **Zero occurrences of `TOOL_API_KEY` across 52 bundled skills + 6 extension skills + the entire gateway source tree** (verified by `rg TOOL_API_KEY` → 0 matches in `C:\temp\openclaw-rootfs` and `C:\temp\openclaw-src` and `C:\temp\openclaw-src-main`).

### 2. OpenClaw `skills.entries[slug]` schema (definitive)

From `src/config/types.skills.ts:3-8` (identical in image and source):

```ts
export type SkillConfig = {
  enabled?: boolean;
  apiKey?: SecretInput;           // literal string OR secret ref
  env?: Record<string, string>;   // name → value map
  config?: Record<string, unknown>;
};
```

And the Zod schema at `src/config/zod-schema.ts:761-767` (using `.strict()` — unknown fields throw):

```ts
.object({
  enabled: z.boolean().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive),
  env: z.record(z.string(), z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})
.strict(),
```

The upstream docs at `docs/tools/skills-config.md:29-38` give the canonical example, reproduced verbatim:

```json5
entries: {
  "image-lab": {
    enabled: true,
    apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" }, // or plaintext string
    env: {
      GEMINI_API_KEY: "GEMINI_KEY_HERE",
    },
  },
  peekaboo: { enabled: true },
  sag: { enabled: false },
}
```

**Key takeaway about `apiKey`:** it binds to the skill's declared `primaryEnv` at runtime, so the host (us) does not need to know the env var's name. We set `skills.entries.notion.apiKey = "<decrypted>"` and OpenClaw exposes it to the skill as `$NOTION_API_KEY` because the `notion` SKILL.md frontmatter declares `primaryEnv: "NOTION_API_KEY"`.

### 3. Runtime env merge behaviour (Task 4)

From `src/agents/skills/env-overrides.ts:77-134` (image, `applySkillConfigEnvOverrides`):

```ts
// 1. Build the allowlist of sensitive keys the skill is permitted to inject.
//    Only primaryEnv + requires.env[] are allowed. Everything else is blocked.
const allowedSensitiveKeys = new Set<string>();
if (primaryEnv) allowedSensitiveKeys.add(primaryEnv);
for (const envName of requiredEnv ?? []) allowedSensitiveKeys.add(envName);

// 2. Take entries from skills.entries[slug].env — but ONLY if process.env[key]
//    is not already set. Container-level env wins.
if (skillConfig.env) {
  for (const [rawKey, envValue] of Object.entries(skillConfig.env)) {
    const envKey = rawKey.trim();
    if (!envKey || !envValue || process.env[envKey]) continue;  // <-- skip if global already set
    pendingOverrides[envKey] = envValue;
  }
}

// 3. If skills.entries[slug].apiKey is set AND the skill declares primaryEnv,
//    inject the apiKey value under primaryEnv's name (unless already set).
const resolvedApiKey = typeof skillConfig.apiKey === "string" ? skillConfig.apiKey.trim() : "";
if (normalizedPrimaryEnv && resolvedApiKey && !process.env[normalizedPrimaryEnv]) {
  if (!pendingOverrides[normalizedPrimaryEnv]) {
    pendingOverrides[normalizedPrimaryEnv] = resolvedApiKey;
  }
}

// 4. Sanitize against host-dangerous names (OPENSSL_CONF etc.) and enforce
//    the allowlist from step 1.
const sanitized = sanitizeSkillEnvOverrides({ overrides: pendingOverrides, allowedSensitiveKeys });

// 5. Apply to process.env — track prior values so revert can restore them.
for (const [envKey, envValue] of Object.entries(sanitized.allowed)) {
  if (process.env[envKey]) continue;
  updates.push({ key: envKey, prev: process.env[envKey] });
  process.env[envKey] = envValue;
}
```

And from `src/agents/skills/config.ts:94-99` (the availability check visible to the skill at runtime):

```ts
hasEnv: (envName) =>
  Boolean(
    process.env[envName] ||
    skillConfig?.env?.[envName] ||
    (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName),
  )
```

**Conclusions:**

- Env vars from `skills.entries[slug].env` get merged into `process.env` globally at skill activation. This is **not** a per-skill scope — the rest of the process also sees them.
- The merge is **gated by allowlist**: only `primaryEnv` and `requires.env[]` names can be injected. A skill cannot smuggle arbitrary env vars in. Attempts to inject host-dangerous names (e.g. `OPENSSL_CONF`) are hard-blocked regardless.
- **Container-level env (from `.env`) wins**. If the deployer sets `NOTION_API_KEY` in `.env` (via `CLAWS_ENV_B64`), a `skills.entries.notion.env.NOTION_API_KEY` value is silently ignored. Same for the `apiKey` shortcut.
- The `apiKey` shortcut is bound to `primaryEnv` by name. If a skill doesn't declare `primaryEnv`, `apiKey` has no effect (nothing to bind to).
- Updates are reversible on skill deactivation (`updates[]` stores the `prev` value, and the reverter restores it). So skill env doesn't leak permanently into the host process.

### 4. Container `.env` vs `skills.entries.env` namespace (Task 5)

From `docs/CONTAINER_INFRASTRUCTURE.md:68-73` (our repo):

- `CLAWS_ENV_B64` carries the base64-encoded `.env` file containing platform keys (ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, SLACK_BOT_TOKEN, etc.). The container's start command decodes it and writes it to `/home/node/.openclaw/.env`, which OpenClaw loads into `process.env` at boot.
- `skills.entries[slug].env` injections happen **later**, at skill activation, and are conditional on `process.env[key]` not already being set (step 2 above).

So the two namespaces are the **same underlying `process.env`**, with `.env`-loaded values effectively permanent and `skills.entries.env` values transient + allowlisted + deferred-to-container.

**Collision rules summary:**

| Scenario | Who wins |
|---|---|
| `NOTION_API_KEY` in `.env` + `skills.entries.notion.apiKey = "xxx"` (different value) | `.env` (because `process.env.NOTION_API_KEY` is already set when the skill's apiKey tries to inject) |
| `skills.entries.notion.env.NOTION_API_KEY` + `skills.entries.notion.apiKey = "xxx"` (both set) | `env` wins for that key (step 2 runs before step 3) |
| Two enabled skills both declaring `primaryEnv: "OPENAI_API_KEY"` — first sets it, second tries to set a different value | First enabled skill wins. Second skill's attempt is skipped because `process.env` is already set. |

For our fix this matters because: we can NOT have two connected tools both mapping to the same `primaryEnv` with different values. Our schema enforces one `ToolConnection` row per (workspaceId, toolSlug), so the risk is narrow — but PR #3 needs to iterate skills in a deterministic order and decide what happens if the same env-var name appears on two different skills the user has connected. Escalate as a footnote for PR #3, not a blocker here.

### 5. Our seeded internal convention (Task 2)

```bash
grep -rn "TOOL_API_KEY" prisma/ src/data/ src/lib/ | wc -l
```

Counts (repo-local):

| Location | `TOOL_API_KEY` references |
|---|---|
| `prisma/seed-data/skills-tool-specific.ts` | **84** (all inside `skillMd` template strings) |
| `docs/TOOL_CONNECTION_FIX_INVESTIGATION.md` | 17 (narrative references, not executable) |
| Everywhere else in `prisma/`, `src/data/`, `src/lib/` | **0** |

Every single one of the 84 is a `$TOOL_API_KEY` interpolation inside a seeded `Skill.skillMd` body — `curl -H "Authorization: Bearer $TOOL_API_KEY"` and variants. The name exists nowhere in our runtime code, nowhere in Prisma enums, nowhere in config files, and (as established in Task 1) nowhere in OpenClaw.

This is the full extent of the "convention": **84 template-string hits in one seed file, zero enforcement, zero runtime binding, invented by us under `@ts-nocheck`**.

### 6. MarketplaceSkill convention (Task 3)

From `prisma/seed-data/marketplace-skills.ts:56, 68` (representative rows):

```ts
{ slug: "github-issues", ..., requiredEnvVars: ["GITHUB_TOKEN"], ... },
{ slug: "snyk-scanner",  ..., requiredEnvVars: ["SNYK_TOKEN"], ... },
{ slug: "git-operations",..., requiredEnvVars: [],              ... },
```

And from the publish UI at `src/app/publish/skill/page.tsx:211`:

```tsx
<Input
  value={envVarInput}
  onChange={(e) => setEnvVarInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
  onKeyDown={(e) => { if (e.key === "Enter") { ... if (/^[A-Z][A-Z0-9_]*$/.test(envVarInput)) addItem(...) } }}
  placeholder="HUBSPOT_API_KEY"
  maxLength={100}
  disabled={envVars.length >= 20}
/>
```

- Placeholder is `HUBSPOT_API_KEY`.
- Regex enforces `^[A-Z][A-Z0-9_]*$` — SCREAMING_SNAKE_CASE named env vars only.
- No affordance for a generic placeholder.

**Conclusion:** MarketplaceSkill (data + UI) is already fully aligned with OpenClaw's named-env convention. No changes needed there. It's our internal `Skill` seeds that drift.

---

## Options evaluated

### Option 1 — Generic `TOOL_API_KEY` across all tools

**What it means:** Emit `skills.entries[<skill-slug>].env.TOOL_API_KEY = "<decrypted>"` for every connected API_KEY tool. Our seed `skillMd` keeps using `$TOOL_API_KEY` in curl examples.

**Pros:**
- No per-tool mapping needed in the generator.
- Zero changes to seed files.

**Cons (all blocking):**
- **`TOOL_API_KEY` isn't a name any bundled skill's frontmatter declares.** When OpenClaw's env allowlist check runs (step 4 in the merge flow above), `TOOL_API_KEY` is NOT in `allowedSensitiveKeys` for any bundled skill — it would be **rejected and logged as a blocked override**. The key never makes it into the skill's process.env. Agent tool calls fail, same as the current bug.
- **Conflicts with MarketplaceSkill.** When the marketplace installer eventually emits a row whose `skillMd` uses `$HUBSPOT_API_KEY`, and we've set `skills.entries.hubspot-crm.env.TOOL_API_KEY`, the skill won't find its value. We'd need a second generator path for marketplace skills. Two conventions in the same generator.
- **Two skills activated concurrently, both with `TOOL_API_KEY`, different values** → first-wins (see collision rules) and the second silently gets the first's key. Very hard to debug.

**Verdict:** doesn't actually work. The assumption that OpenClaw accepts a generic placeholder is incorrect — OpenClaw's runtime explicitly validates env keys against each skill's declared allowlist.

### Option 2 — Named env vars per tool

**What it means:** For each seeded `Skill`, ensure its `skillMd` uses the frontmatter-declared `primaryEnv` (e.g., `$HUBSPOT_API_KEY` for the hubspot skill, `$APOLLO_API_KEY` for apollo, etc.). Generator emits `skills.entries[<slug>].apiKey = "<decrypted>"` and lets OpenClaw bind it to the skill's `primaryEnv`.

**Pros:**
- **Matches OpenClaw's runtime.** `apiKey` + `primaryEnv` binding is the documented path (see `docs/tools/skills-config.md:29-38` in upstream source).
- **One generator path for internal + marketplace.** MarketplaceSkill already uses named env vars. We can share the emission logic.
- **Allowlist check passes.** `apiKey` gets bound to `primaryEnv` which IS in the skill's allowlist (because the skill itself declared it).
- **No collision ambiguity.** Two connected tools only collide if both skills declare the same `primaryEnv`, which is a meaningful signal (user probably shouldn't have both anyway).
- **Zero back-compat cost.** No existing deployment has a non-empty `skills.entries` (today's bug guarantees that), so the first deploy on the new convention is effectively a greenfield.

**Cons:**
- Requires editing our 84 `$TOOL_API_KEY` interpolations in `skills-tool-specific.ts` to the tool-specific named vars (`$HUBSPOT_API_KEY`, `$APOLLO_API_KEY`, ...). Rough count: 19 unique `Skill` rows in that file, each with 2-5 curl examples → ~84 edits, one-to-one with the existing hits.
- Requires adding `primaryEnv` metadata to our internal `Skill` model (or storing it outside, e.g. a map in the generator or a new column) so PR #3 can look it up. This is small — see "Implementation outline" below.
- Each new tool we add requires picking a `primaryEnv` name (usually obvious — `ZAPIER_API_KEY`, `FOO_TOKEN` — but needs to be documented in the tool catalog).

**Verdict:** this is what OpenClaw actually expects.

### Option 3 — Hybrid (generic for internal, named for marketplace, bridge at install time)

**What it means:** Keep `$TOOL_API_KEY` in our seeded `Skill.skillMd`. Write a bridge that rewrites marketplace skills' `$HUBSPOT_API_KEY` → `$TOOL_API_KEY` at install time, or vice versa.

**Pros:**
- Preserves our existing seed content.

**Cons (all blocking):**
- **Still doesn't match OpenClaw** for the internal skills — same problem as Option 1: `TOOL_API_KEY` isn't in any bundled skill's allowlist.
- **Two generator paths** + a rewriter that has to parse markdown at install time. Substantially more code than Option 2.
- **Doesn't handle multi-var tools.** Trello, Salesforce, Binance, etc. need multiple named vars. A generic single name can't express that.

**Verdict:** worst of both worlds.

---

## Recommendation — Option 2 (named per tool)

### Why

- It's the convention OpenClaw already expects and enforces at the allowlist boundary.
- It reuses one path for internal and marketplace skills, so PR #5 (marketplace install) and PR #3 (internal fix) can share emission logic.
- No existing deployment uses any other convention today (Item 1 below). So "back-compat" is trivially satisfied: there's nothing to preserve.
- It handles multi-var tools (Option 2 naturally extends to the `env` map for Trello-style multi-credential skills; Option 1 doesn't).

### Downstream implications

**PR #2 (multi-credential schema + generator):**
- Use `skills.entries[<slug>].env = { <envName1>: <value1>, <envName2>: <value2>, ... }` for multi-credential tools (Trello, Salesforce, Binance, Coinbase, Alpaca).
- Use `skills.entries[<slug>].apiKey = "<value>"` for single-credential tools — lets OpenClaw bind to `primaryEnv` without us knowing the name.
- Schema addition needed on `ToolConnection`: a JSON column (or a new `ToolCredential` side-table) to hold multi-value credential bags keyed by env-var name. Plus the Setup Wizard UI work.

**PR #3 (tool connection fix):**
- Generator emits `skills.entries[<skill.slug>].apiKey = decrypt(toolConn.encryptedApiKey)` for every connected API_KEY tool whose mapped skill declares a `primaryEnv`.
- For skills without a `primaryEnv` (e.g., GitHub, where auth is via `gh auth login`) — emit only `{ enabled: true }`. The credential isn't needed in `skills.entries.env` because the skill delegates auth to the binary. (Open question: for GitHub specifically, do we pass the token via the `.env` as `GITHUB_TOKEN` so `gh auth login --with-token <<<"$GITHUB_TOKEN"` works? Likely yes, but it's a Container `.env` concern, not `skills.entries.env`. Decide in PR #3.)
- **Does NOT need per-tool mapping code in the generator.** OpenClaw reads `primaryEnv` from the bundled SKILL.md at runtime. Our generator only needs to know the skill slug; it doesn't need to know the env var name.
- Drop the 84 `$TOOL_API_KEY` references from `skills-tool-specific.ts` `skillMd` bodies and replace with tool-specific names pulled from OpenClaw's frontmatter where a bundled skill exists, or from the catalog entry's (new) `primaryEnv` field for our custom skills. Exact list in "Seed migration" below.

**PR #5 (marketplace skill install):**
- No change from the architecture doc: marketplace skills already use `requiredEnvVars: ["HUBSPOT_API_KEY", ...]` and the publish UI enforces named vars.
- Install path emits `skills.entries[<marketplace.slug>].env = { <var>: <value>, ... }` for each declared `requiredEnvVar`.
- Single-credential marketplace skills (one entry in `requiredEnvVars`) could also use the `apiKey` shortcut, but only if the bundled skill declares `primaryEnv`. Marketplace skills don't ship bundled SKILL.md frontmatter to us — so always use explicit `env` for marketplace. Safer.

### Migration plan (for PR #3, not this PR)

**Seed edits needed in `prisma/seed-data/skills-tool-specific.ts`:**

Rough count: 19 `skillMd` blocks × ~4 `$TOOL_API_KEY` hits each = ~84 edits. Each edit is a literal rename — e.g., inside the HubSpot skill's `skillMd`, every `$TOOL_API_KEY` → `$HUBSPOT_API_KEY`. No logic changes. An `rg`-assisted sweep per skill, verified against a table of skill-slug → env-var-name.

**New field on our `Skill` model (optional, nice-to-have):**

Adding a `primaryEnv: String?` column on `Skill` gives the generator a direct lookup rather than parsing frontmatter out of `skillMd`. Small migration. Could defer if we decide to just parse from the `skillMd` frontmatter in the generator.

**Back-compat:**

Zero. No existing deployment has a populated `skills.entries` today. Proof: [TOOL_CONNECTION_FIX_INVESTIGATION.md §1 "Runtime consequences"](./TOOL_CONNECTION_FIX_INVESTIGATION.md#runtime-consequences-what-happens-in-prod) — the current generator's `if (!toolConn.skillSlug) continue` always fires, so `config.skills` never gets set. PR #3 is effectively building this path from scratch.

---

## What this doc does NOT resolve

- **Multi-credential tool UX.** The Setup Wizard currently captures a single API key per connection. Schema needs a multi-value credential bag, UI needs multi-field input. Handled in PR #2.
- **Composio OAuth credential injection.** OAUTH_COMPOSIO tools are a different story — Composio handles auth at runtime via `composioConnectionId`, and we emit `{ enabled: true }` (no `apiKey`, no `env`) for those. Handled in PR #1b.
- **Channel tokens.** Slack, Discord, Telegram, WhatsApp tokens go through `channels.<platform>` config (separate subsystem), not `skills.entries.env`. Already works correctly via `CLAWS_ENV_B64`.
- **Custom API (USER_GENERATED) skill env emission.** Custom APIs get a generated skill at workspace time — its env vars would be user-defined. Handled in PR #6.
- **Parsing `primaryEnv` out of `skillMd` YAML at generator time vs storing it on the Skill model.** Minor implementation detail for PR #3.
- **Collisions where two connected tools both declare the same `primaryEnv`.** Probably a Setup Wizard warning, not a generator concern. Flag for PR #3.

---

## Appendix A: Raw grep counts (reproducible)

From the pinned sources (`C:\temp\openclaw-rootfs`, `C:\temp\openclaw-src` at `d76b224`, `C:\temp\openclaw-src-main` at `50e71da`):

| Query | Image | v2026.3.1 | main (2026.4.16) |
|---|---|---|---|
| `TOOL_API_KEY` (any case) | 0 | 0 | 0 |
| `skills.entries` | 6 files (all code / test / doc) | same | same |
| `primaryEnv` | 4 files (`frontmatter.ts`, `config.ts`, `env-overrides.ts`, `types.ts`, plus tests) | same | same + extra tests |
| SKILL.md files under `skills/` | 52 | 52 | (main: more, new skills added since) |

From this repo (`c:\Users\...\laxclaws`):

| Query | Count | Files |
|---|---|---|
| `TOOL_API_KEY` | 101 | `prisma/seed-data/skills-tool-specific.ts` (84), `docs/TOOL_CONNECTION_FIX_INVESTIGATION.md` (17) |
| `TOOL_API_KEY` outside `docs/` and seed | 0 | — |

---

## Appendix B: Files cited

OpenClaw source / image:

- `/app/package.json` — image version
- `/app/src/config/types.skills.ts:3-8` — `SkillConfig` type
- `/app/src/config/zod-schema.ts:761-767` — Zod schema with `.strict()`
- `/app/src/config/config.skills-entries-config.test.ts:1-47` — schema test (accepts `config`, rejects unknown fields)
- `/app/src/config/config.secrets-schema.test.ts:70-83` — `skills.entries.*.apiKey` with secret refs accepted
- `/app/src/agents/skills/config.ts:94-99` — runtime `hasEnv` resolution order
- `/app/src/agents/skills/env-overrides.ts:77-134` — merge into `process.env` with allowlist
- `/app/src/agents/skills/frontmatter.ts:207` — `primaryEnv` parsed from skill frontmatter
- `/app/src/agents/skills/types.ts:20-25` — `primaryEnv` on `SkillMetadata`
- `/app/docs/tools/skills-config.md:29-38` — canonical usage example
- `/app/skills/notion/SKILL.md:8` — `primaryEnv: "NOTION_API_KEY"`
- `/app/skills/trello/SKILL.md:8` — multi-var example: `requires.env: ["TRELLO_API_KEY", "TRELLO_TOKEN"]`
- `/app/skills/github/SKILL.md:4` — external CLI auth example
- (plus the 12 other SKILL.md files cross-referenced above)

This repo:

- `src/lib/openclaw/generator.ts` — current broken generator (`@ts-nocheck`), subject of the upcoming PR #3
- `prisma/seed-data/skills-tool-specific.ts:17,25,32,...` — 84 `$TOOL_API_KEY` hits to be renamed in PR #3
- `prisma/seed-data/marketplace-skills.ts:56,68` — MarketplaceSkill already named-per-tool
- `src/app/publish/skill/page.tsx:211` — publish UI enforces SCREAMING_SNAKE_CASE
- `prisma/schema.prisma:321-352` — `Skill` model
- `prisma/schema.prisma:425-450` — `ToolConnection` model
- `prisma/schema.prisma:856-906` — `MarketplaceSkill` model
- `docs/TOOL_CONNECTION_FIX_INVESTIGATION.md §6` — prior (revised) recommendation
- `docs/CONTAINER_INFRASTRUCTURE.md:68-73` — container `.env` delivery via `CLAWS_ENV_B64`
