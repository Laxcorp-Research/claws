# Runtime contracts - overlay ↔ OpenClaw `dist`

Durable ledger of every OpenClaw internal the Claws overlay depends on.
This is the checklist the rule-36 suite (and any RUNTIME-AUTOUPDATE candidate
build) must walk. Hashed `dist/*.js` filenames rotate on every upstream
rebuild; the **source path + symbol** is the contract. The 2026.5.22 hash is
pin evidence only.

| Field | Value |
|---|---|
| Staging pin (do not change in Phase A) | `OpenClawVersion` `2026.5.22-18` (`isStable=true`) |
| Image | `ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-18` |
| Upstream tag | `v2026.5.22` (`buildSourceTag`) |
| Overlay sources | `docker/Dockerfile`, `container/*`, emit from `src/lib/openclaw/generator.ts` |
| Newest upstream surveyed | `v2026.9.4` (published 2026-09-11, `openclaw` package `2026.9.4`) |
| Phase A candidate (2026-09-12) | Image `ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4` built + registered `isStable=false` / `isLatest=true`. Staging pin **unchanged** (`2026.5.22-18`). Per-workspace soak: `Workspace.candidateRuntimeSoak` (PR-2). KEEP canary stays hibernated on 5.22-18. |
| Companion | [OPENCLAW_GATEWAY_PROTOCOL.md](./OPENCLAW_GATEWAY_PROTOCOL.md), [COMPOSIO_RUNTIME_CONTRACT.md](./COMPOSIO_RUNTIME_CONTRACT.md) |

**Coupling model:** the overlay does **not** `import()` hashed `dist/*.js` at
runtime. Coupling is (1) `openclaw.json` / `cron/jobs.json` emission that must
parse `OpenClawSchema`, (2) plugin `api` shape (`register` / `api.on` /
`registerHttpRoute`), (3) on-disk session + cron formats, (4) CLI spawn of
`/app/openclaw.mjs`, (5) `createRequire("/app/package.json")` for `croner`.

If a candidate build changes any row below, the overlay is **not** a drop-in.

---

## 1. Dist / source ledger (file + symbol + why)

Hashed names are from a `v2026.5.22` image extract. Re-resolve hashes on every
candidate clone; fail the candidate if the **symbol** is gone even if the hash
changed.

### 1.1 Config schema (generator emit)

| Dist @ `v2026.5.22` | Upstream source | Symbol | Why Claws depends on it |
|---|---|---|---|
| `dist/zod-schema-Dsy5tXpj.js` | `src/config/zod-schema.ts` | `OpenClawSchema` (`z.strictObject`) | `openclaw.json` must parse or the gateway refuses boot. Unknown keys fail closed. |
| `dist/zod-schema.core-D7Y_eqdd.js` | `src/config/zod-schema.core.ts` | `ModelsConfigSchema`, `ModelProviderSchema.baseUrl`, `isBuiltInModelProviderOverlayId` | Credit mode emits `models.providers.anthropic.baseUrl`. Runtime does **not** read `ANTHROPIC_BASE_URL`. |
| `dist/zod-schema.agent-runtime-Bq5CXVVg.js` | `src/config/zod-schema.agent-runtime.ts` | `ToolsWebSearchSchema.enabled`, `ToolPolicyWithProfileSchema.deny`, `AgentEntrySchema` | `tools.web.search.enabled: false` when no search backend; `tools.deny` (`dir_list`, `composio__*`); `thinkingDefault` subset. |
| (schema via same tree) | `src/config/zod-schema.agents.ts` | `AgentsSchema.entries` **@ 9.4** (strict; no `list`) | Overlay emits keyed `agents.entries` with normalized ids. `ownership: "explicit"` + `defaults.systemAgent.agentId`. No inner `id`, no `default: true`. |
| (schema via same tree) | `src/config/zod-schema.root-support.ts` | `PluginEntrySchema.hooks.allowConversationAccess` | Non-bundled plugin hooks are dropped unless this is `true`. Staging boot previously logged the block. |
| `dist/model-cgt_Zkgh.js` | model client | `applyConfiguredProviderOverrides` | Confirms env `ANTHROPIC_BASE_URL` is ignored; generator must emit `models.providers`. |

**Generator emits (9.4-shaped, overlay port):**

- `gateway.mode=local`, `bind=lan`, `port=18789`
- `agents.ownership="explicit"`
- `agents.entries` keyed by `toAgentId(name)` (no `agents.list`, no `default: true`)
- `agents.defaults.systemAgent.agentId=<orchestratorId>` (unmatched-channel / dashboard fallback)
- `OPENCLAW_CONFIG_READONLY=1` in Railway env and generated `.env` (doctor cannot rewrite generator-owned `openclaw.json`)
- `plugins.load.paths=['/opt/claws-activity-reporter']`
- `plugins.entries.claws-activity-reporter` `{ enabled, hooks.allowConversationAccess: true }`
- `plugins.entries.admin-http-rpc` `{ enabled: true }` only - configSchema is `additionalProperties: false`
- `cron/jobs.json` with `id`, `schedule.kind=cron`, `sessionTarget: session:agent:<slug>:main` (never literal `main` + `agentTurn`)
- MCP `streamable-http` + static `x-api-key` (no env interpolation) when long-tail flag is on

**9.4 id contract:** `toAgentId()` is lowercase `[a-z0-9-]` ≤64 and must already satisfy `normalizeAgentId` / entries-key `/^[a-z0-9_][a-z0-9_-]{0,63}$/i`. We do **not** rely on load-time `agents.list` migration.

**Routing:** `ownership: "explicit"` cannot combine with `default: true`. Dashboard chat uses `systemAgent.agentId`. `bindings: [{ match: { channel: '*' } }]` remains a no-op (gateway protocol §4 / §8 risk 2).

### 1.2 Tools / MCP / sandbox

| Dist @ `v2026.5.22` | Upstream source | Symbol | Why |
|---|---|---|---|
| `dist/attempt-tool-construction-plan-Cj2y72Gx.js` | `src/agents/attempt-tool-construction-plan.ts` | `shouldCreateBundleMcpRuntimeForAttempt` | `composio__*` deny skips bundle MCP runtime (token tax). |
| `dist/tool-policy-match-C9WqMgmG.js` | `src/agents/tool-policy-match.ts` | `makeToolPolicyMatcher` / `compileGlobPatterns` | Glob deny `composio__*` must still match. |
| `dist/host-env-security-66KkrZF_.js` | `src/infra/host-env-security.ts` | sanitizer allowlist | Skill `env` emission + SKILL.md `primaryEnv` / `requires.env`. |
| (vendored fixture @ v2026.9.4) | `src/agents/sandbox/sanitize-env-vars.ts` + `src/skills/runtime/env-overrides.ts` | `sanitizeSkillEnvOverrides` | Fixture at `src/test/fixtures/openclaw-sanitizer/` re-vendored **2026-09-12** from `v2026.9.4`. Old path `src/agents/skills/env-overrides.ts` is gone. |

### 1.3 Plugins / hooks

| Dist @ `v2026.5.22` | Upstream source | Symbol | Why |
|---|---|---|---|
| `dist/plugin-sdk/plugin-entry.js` → `dist/plugin-entry-Dgh5bRuw.js` | `src/plugin-sdk/plugin-entry.ts` (9.4 also `packages/plugin-sdk`) | `definePluginEntry`, `unwrapDefaultModuleExport` | Overlay **mimics** the plain-object entry (`id`, `name`, `configSchema`, `register(api)`). Does not import SDK (plugin lives at `/opt/claws-activity-reporter`). |
| `dist/hooks-DG2iwSA7.js` / `dist/hooks-BrCZyF5b.js` | `src/plugins/hooks.ts` | `api.on`, `runVoidHook` @ 5.22; **`runModifyingHook` + fail-closed** for `before_agent_run` @ 9.4 | Activity reporter registers 8 hooks. |
| (HTTP plugin API) | plugin HTTP router | `api.registerHttpRoute` | `POST /internal/sync-now`, `auth: "plugin"`, `match: "exact"`. |

**Hooks used:** `before_agent_run`, `agent_end`, `message_received`,
`message_sent`, `after_tool_call`, `cron_changed`, `gateway_start`,
`gateway_stop`.

**9.4 overlay contract (`src/plugins/hooks.ts` @ v2026.9.4):**

- `before_agent_run` is a **modifying gate** (`runBeforeAgentRun` →
  `runModifyingHook`), default timeout **15s**, failure policy **fail-closed**.
- Overlay handler returns exactly `{ outcome: "pass" }` (one key) after the
  synchronous TASK_START push. **No `timeoutMs`** on that registration - a
  100ms timeout throws and blocks the turn.
- Other void hooks keep `{ timeoutMs: 100 }`. `gateway_stop` stays 5s.

### 1.4 Sessions / thinking

| On-disk / dist | Upstream source | Symbol | Why |
|---|---|---|---|
| `agents/<id>/sessions/sessions.json` + `<uuid>.jsonl` | 5.22 / **legacy volumes only** | index + transcript | jsonl heal + index rebuild kept for unmigrated volumes. Rebuild **skips** when sqlite is present (must not recreate `sessions.json`). |
| (9.4) `agents/<id>/agent/openclaw-agent.sqlite` | `src/state/openclaw-agent-db.paths.ts` | sqlite store | thinking-signature TEXT walker + state-sync bundle. Wake path runs `openclaw doctor --fix` **before** gateway (`container/volume-migration.mjs`, ledger `runtime_volume_migration`, registry `runtime-volume-migration`, `soakCounts: false`). |

### 1.5 Cron / catch-up

| Dist / package | Upstream source | Symbol | Why |
|---|---|---|---|
| `/app/node_modules/croner` via `createRequire("/app/package.json")` | `croner@10.0.1` (still pinned in 9.4 `package.json`) | `Cron`, `previousRuns`, `nextRun` | `container/heartbeat-catchup.mjs` (`-13`). Image has no `cron-parser`. |
| `cron/jobs.json` | `src/cron/store.ts` | `resolveDefaultCronStorePath`, `loadCronStore`, `saveCronStore` | **R16:** 9.4 canonical cron store is this JSON file (plus `jobs-state.json`), **not** sqlite. Overlay emits it on every deploy (upsert by job id; `[]` removes stale Claws-managed jobs). Catch-up reads the same path. |
| `cron/jobs.json` shape | `src/cron/persisted-shape.ts` | `getInvalidPersistedCronJobReason` (`missing-id`, …) | Jobs without string `id` are dropped at load. 9.1+ quarantines malformed rows instead of blocking boot. |
| `dist/extensions/admin-http-rpc/` | `extensions/admin-http-rpc/src/methods.ts` | `health`, `cron.run` | Catch-up: `POST /api/v1/admin/rpc` `{ method: "cron.run", params: { id, mode: "force" } }` after `health`. **Still allowlisted on 9.4.** |
| (jobs service) | `src/cron/service/jobs.ts` | `sessionTarget` | Overlay must not emit `sessionTarget: "main"` + `payload.kind: "agentTurn"` (5.22 dropped that pair). Overlay uses `session:agent:<slug>:main`. |

### 1.6 Process / CLI

| Path in image | Symbol | Why |
|---|---|---|
| `/app/openclaw.mjs` | CLI `gateway --allow-unconfigured --bind lan --port` | `container/process-manager.mjs` spawn. Railway start command in `src/lib/openclaw/railway-client.ts` matches. |
| `/opt/claws-activity-reporter/` | plugin manifest `openclaw.plugin.json` `activation.onStartup` | Copied by `docker/Dockerfile`. Path is hardcoded in generator. |

### 1.7 Platform ↔ gateway protocol (not overlay, still dist)

Dashboard chat depends on gateway WS methods documented in
[OPENCLAW_GATEWAY_PROTOCOL.md](./OPENCLAW_GATEWAY_PROTOCOL.md) at `v2026.5.22`:
`chat.send` / `chat.history` / `sessions.*`, connect handshake, device identity,
`resolve-route.ts` (exact channel name; `channel:'*'` does not wildcard).
Re-verify on any candidate that claims “chat still works”.

---

## 2. Rule-36 / contract-suite checklist

Walk this list on **every** candidate image. Overlay-source locks live in
`src/lib/openclaw/__tests__/runtime-contracts-r15.test.ts` (includes R16). Clone-tag greps
run in `.github/workflows/runtime-contracts-94.yml` against unsuffixed
`upstream_tag` `v2026.9.4`. Staging pin is still `2026.5.22-18` until soak
promote.

| # | Contract | How we lock it today | 9.4 status |
|---|---|---|---|
| R1 | Build does not move `:candidate` or `:latest` | `src/__tests__/build-openclaw-image-workflow.test.ts` (`STOP_MOVING_CANDIDATE_ASSERT`) | still required |
| R2 | Register is XOR `isStable` / `isCandidate`; candidate → `isLatest` only | `src/app/api/internal/versions/register/__tests__/route.test.ts` | `resolveDeployImage()` reads **`isLatest` only** when `Workspace.candidateRuntimeSoak` is true **and** `mayDeployCandidateImage` passes (staging clone, never KEEP, never production). Unflagged / KEEP / prod still `isStable` only. |
| R3 | Force-update refuses non-stable | `src/__tests__/api/admin/versions.test.ts` | **blocks** fleet pin to 9.4. Per-workspace soak is the admin `candidate-soak` flag + next `deployToCloud`, not force-update. |
| R4 | `openclaw.json` emission (`agents.entries`, plugins, deny, channels) | `generator.test.ts` + `runtime-contracts-r15.test.ts` + clone-tag | **ported and version-keyed (R17)** - the 9.4 shape (entries, no `list`/`default: true`, `OPENCLAW_CONFIG_READONLY=1`) is emitted only for `runtimeContract: "9.4"` targets |
| R5 | Heartbeat croner jobs + `session:agent:<slug>:main` | heartbeat-schedule + generator cron tests + clone-tag `croner@10.0.1` | overlay lock + clone-tag |
| R6 | Activity reporter: `{ outcome: "pass" }`, no 100ms on `before_agent_run` | `claws-activity-reporter.test.ts` | **ported** - fail-closed gate is explicitly non-blocking |
| R7 | Catch-up: croner loader, `health` + `cron.run` `{id, mode:"force"}`, skip ledger | `heartbeat-catchup.test.ts` + clone-tag methods | methods still allowlisted |
| R8 | Thinking-signature sqlite + jsonl strip + one retry | `thinking-signature-heal-overlay.test.ts` | **ported** - TEXT walker on `openclaw-agent.sqlite`; jsonl kept for legacy |
| R9 | State-sync sqlite bundle; no `sessions.json` rebuild over sqlite | `state-sync.test.ts` + `rebuild-sessions-index.test.ts` | **ported** |
| R10 | Skill env sanitizer vs vendored OpenClaw 9.4 | `sanitizer-contract.test.ts` | **re-vendored** `v2026.9.4` (`env-overrides.ts` new path) |
| R11 | Beat evidence (HEARTBEAT / poll-marker TASK_START) | `beat-evidence-contract.test.ts` | overlay_boot must not clear sticky |
| R12 | Live exec write `shared/deliverables/smoke.md` | `.github/workflows/runtime-contracts-94.yml` exec-smoke job (image); KEEP canary never used | clone soak: flag `candidateRuntimeSoak` on a **clone**, never `cmr3fo19r000404jlze8o7dm8` |
| R13 | Live mission/cron enqueue + extract + approve | same receipt | candidate soak workspace (interview-free + `httpFixtureMode`) |
| R14 | Hibernate hold + flush | sqlite in state-sync bundle; live soak quotes HWD on the clone | jsonl-only flush closed on overlay; live HWD quotes on flagged clone |
| R15 | Gateway healthz `{"ok":true,"status":"live"}` | process-manager + volume migration before gateway | first signal after candidate boot on the flagged clone |
| R16 | 9.4 cron canonical store is `cron/jobs.json` (not sqlite); emit/upsert on every deploy | `container/cron-store.mjs` + `buildWorkspaceFileMap` always writes jobs.json (including `[]`); clone-tag greps `src/cron/store.ts` | redeploy with a changed schedule → jobs.json reflects it → beat fires. **Doctor's "Cron store migrated to SQLite" boot log is benign:** doctor imports the overlay-written `jobs.json` into its own store at boot and the scheduler fires from there - receipted live on the soak clone 2026-09-13: `[cron:heartbeat-twitter-commander-md-0-8]` fired at exactly 08:00:00Z on `2026.9.4-5`, `HEARTBEAT_OK`, deliverable `x-morning-trends` extracted 08:04:54Z. The catch-up module's post-migration "no-jobs" read only affects boot catch-up, never scheduled fires. |
| R17 | **Version-keyed emission**: config shape follows the target image's `OpenClawVersion.runtimeContract` ("5.22" → `agents.list` + orchestrator `default: true`, no `trustedProxies`/`ownership`/`systemAgent`/`READONLY`; "9.4" → keyed `agents.entries` + `ownership: explicit` + `defaults.systemAgent` + `gateway.trustedProxies` + `OPENCLAW_CONFIG_READONLY=1`) | `runtime-contract.test.ts` + `runtime-contract-emission.test.ts` (strict Zod mirrors of BOTH gateway schemas; unconditional-9.4 restored → the 5.22 parse fails) | KEEP (5) P0 2026-09-13: unconditional 9.4 emission boot-looped every 5.22-18 wake on "Invalid config … agents.defaults: Invalid input". `resolveDeployTarget` returns the contract; `Workspace.runtimeImagePin` (explicit version pin) resolves ABOVE candidate soak and stable, and THROWS on an unregistered pin rather than falling back. |
| R18 | **Snapshot generations**: every persist shifts current → `runtimeStatePrevSnapshot` in ONE atomic UPDATE; first persist after a contract change pins the outgoing snapshot in `preMigrationSnapshot*` for 7 days. Rollback = repin the old version + restore the pinned generation (session history recorded after the migration is lost - state it plainly in the promote card). | `state-snapshot-generations.test.ts` (single-statement invariant + shift + 7-day pin); `blob-transport.test.ts` idempotent-noop keeps duplicate finalize from double-shifting | Founder claw 2026-09-13: single-column overwrite destroyed the last 5.22 snapshot on the first 9.4 persist. Sync cap: >80MB hard-cap refusal owner-alerts via `hibernation-refuse-unsafe` (`stale-destroy.test.ts`); chunked upload for >80MB bundles stays a **logged follow-up**. |

KEEP Twitter/X Growth Machine (5) `cmr3fo19r000404jlze8o7dm8` is the archive
canary. **Never** delete, wake-onto-candidate, or use as cleanup. Fixture fire
belongs on a **clone** or a dedicated soak workspace.

---

## 3. Upstream since `v2026.5.22` (overlay-relevant)

Newest **stable** by the same date-tuple rule as
`.github/workflows/build-openclaw-image.yml`: **`v2026.9.4`**
(2026-09-11). Extended-stable `v2026.6.35` published 2026-09-10 is **not**
newer on the YYYY.M.D tuple.

Stable tags after `v2026.5.22` (2026-05-24): `2026.5.26`, `5.27`, `5.28`,
`6.1`, `6.5`, `6.6`, `6.8`, `6.9`, `6.10`, `6.11`, `6.33`, `6.34`, `6.35`
(extended-stable), `7.1`, `7.1-1`, `7.1-2`, `8.1`, `8.2`, `9.1`, `9.2`, `9.3`,
**`9.4`**. Release notes: `https://github.com/openclaw/openclaw/releases/tag/<tag>`.

| Area | What moved (highlights that touch our overlay) |
|---|---|
| **Config schema** | Roster is keyed `agents.entries` (strict Zod). Load migrates `agents.list` only when ids already normalize. `default: true` stripped after capture. `OPENCLAW_CONFIG_READONLY=1` (9.4) blocks doctor/config rewrites of deployment-managed `openclaw.json`. Schema versions in 9.4 package.json: `state: 17`, `agent: 19`. |
| **Tools** | Glob deny still exists. MCP skip via tool-policy matcher still the long-tail path. Host-network / sandbox bind / MCP HTTP redirect / stdio env filters tightened (6.6+). `tools.web.search.enabled` still valid. |
| **Sessions / thinking** | Transcripts became core (5.26). SQLite is canonical by 8.x; 9.4 **refuses boot** on leftover `sessions.json` / non-sqlite stores. Thinking-signature heal that rewrites jsonl will no-op. 9.2: session tools default to all-session visibility (`tools.sessions.visibility`). |
| **Cron** | `croner` still `10.0.1`. **R16:** 9.4 still loads `cron/jobs.json` via `resolveDefaultCronStorePath` / `loadCronStore` (JSON, not sqlite). Overlay unpacks that file on every deploy (including `[]` to drop stale Claws jobs) and re-emits after restore. `missing-id` still drops. 9.1: malformed cron rows **quarantined** instead of blocking boot. `health` + `cron.run` still on admin HTTP RPC. |
| **Sandbox** | Env sanitizer still at `src/agents/sandbox/sanitize-env-vars.ts`. Skill env-overrides path moved (9.4 404 on old file). Daytona backend (8.1). Attachment reads must not cross sibling agent sandboxes (9.4). |
| **Plugins** | SDK deprecations (`before_agent_start`, root `openclaw/plugin-sdk` imports - 6.34). `before_agent_run` is a fail-closed **gate** (9.x). Unified Plugins UI (9.4). `allowConversationAccess` still on `PluginEntrySchema`. |

Staging already has **unpromoted** candidate rows for `2026.6.10`, `6.11`,
`7.1`, `7.1-2`, `8.1`, `9.2` (`isStable=false`). They never became the pin.
That is historical evidence the overlay did **not** survive those soaks.

---

## 4. Candidate protocol (Phase A - no pin, no promote)

1. `build-openclaw-image` with `force_version=<upstream>` on `staging`.
   Register `{ isStable: false, isCandidate: true }`. Workflow must **not**
   move `:candidate` / `:latest` (R1).
2. Do **not** run `promote-openclaw-image`. Do **not** `force-update` (requires
   `isStable`).
3. Overlay port (PR-1): generator emits keyed `agents.entries` +
   `ownership: explicit` + `systemAgent`; sqlite heal/state-sync; wake-path
   `openclaw doctor --fix --non-interactive` before gateway; sanitizer
   re-vendored from `v2026.9.4`; `OPENCLAW_CONFIG_READONLY=1`. Clone-tag CI
   walks R1–R16 vs unsuffixed `v2026.9.4`. **Staging pin is still
   `2026.5.22-18`.**
4. Staging live fire: admin `POST /api/admin/workspaces/:id/candidate-soak`
   `{ enabled: true }` on a **Twitter clone** (never KEEP
   `cmr3fo19r000404jlze8o7dm8`). Next `deployToCloud` / HWD wake pulls
   `OpenClawVersion.isLatest` (currently `2026.9.4`). Dashboard PATCH cannot
   set the flag. Production `CLAWS_ENV` cannot honor it. Interview stamp +
   `httpFixtureMode` default on so the fire is interview-free + fixture.
   Quote: fixture fire, three window beats, decision push, nap/wake, zero
   `thinking-signature` / volume-migration heals over 24h. **Staging pin is
   still `2026.5.22-18` until founder ACK promote.**

---

## 5. RUNTIME-AUTOUPDATE lane (PR-3)

OpenClaw `YYYY.M.D` is **not semver**. `9.3 → 9.4` can rewrite schema, session
store, and hook policy. **Do not auto-promote date-tuple bumps.**

| Class | Example | Promote rule |
|---|---|---|
| Overlay patch | `2026.5.22-18` → `2026.5.22-19` (same upstream tag) | Auto after soak green (`POST /api/internal/runtime/soak-signal`) |
| Date-tuple (treat as minor/major) | `2026.5.22` → `2026.9.4` | Founder ACK via `promote-openclaw-image.yml` (migration-class) |
| Upstream `-N` revision | `2026.7.1` → `2026.7.1-2` | Founder ACK (same as date-tuple) |

Pipeline (daily):

1. Detect newest stable GitHub release (`build-openclaw-image.yml` cron `0 6 * * *`).
2. Candidate build + register (`isCandidate`, no pin) → owner alert `runtime-candidate-ready`.
3. Clone-tag contract job on PRs (`runtime-contracts-94.yml` for the 9.4 port).
4. Per-workspace soak override (PR-2) on a Twitter clone, never KEEP.
5. `soak-signal` `{ green: true }` after 24h zero-heal quotes. Overlay `-N` auto-pins `isStable`. Date-tuple sends founder ACK copy, does **not** pin.
6. Stale candidates (`>14d` unsoaked, not superseded): daily `/api/cron/runtime-autoupdate` owner ping (`runtime-candidate-stale`). Never silence (24h cooldown, not a drop).
7. Six orphan historical candidates (`2026.6.10`, `6.11`, `7.1`, `7.1-2`, `8.1`, `9.2`) marked `supersededAt` in the PR-3 migration. **Not** `2026.9.4`.

Rollback: leave `isStable` on the previous row; soak override off; do not
rewrite `:latest`. 9.4 `OPENCLAW_CONFIG_READONLY=1` is the right long-term
emit so doctor cannot mutate generator-owned `openclaw.json` during soak.
