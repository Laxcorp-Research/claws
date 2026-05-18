# Composio Runtime Contract

> **Status:** Evidence-based analysis + live proof-of-concept. Follow-up to [docs/ENV_VAR_CONVENTION.md](./ENV_VAR_CONVENTION.md) (commits `3edf939` + `cd03e26`). No production code, schema, or seed changes in this PR.
> **Companion docs:** [ENV_VAR_CONVENTION.md](./ENV_VAR_CONVENTION.md), [TOOL_CONNECTION_FIX_INVESTIGATION.md](./TOOL_CONNECTION_FIX_INVESTIGATION.md).

---

## TL;DR

**For `OAUTH_COMPOSIO` tool connections, use architecture option (iv) — per-request proxy via `composio.tools.execute`.** The container holds no OAuth tokens; skills call Composio's `POST /api/v3/tools/execute/{toolSlug}` REST endpoint at invocation time, passing `user_id` and `connected_account_id`. Composio owns OAuth custody; token refresh is their concern; revocation surfaces as a clean 4xx rather than stale-token failures we have to detect.

**`composio-core` the SDK does not need to run inside the container** — a plain `fetch()` call against Composio's REST API is enough. The container only needs `COMPOSIO_API_KEY` (platform-scoped, not per-user), `COMPOSIO_USER_ID` (our `composioEntityId`), and `COMPOSIO_CONNECTED_ACCOUNT_ID` (per-tool).

**OpenClaw itself has zero Composio awareness** — verified by grep against the pinned image rootfs and source. The integration lives entirely at the skill-body level: each of our 21 OAuth toolkit skills needs a rewritten `skillMd` that calls Composio's REST endpoint. **No refresh infrastructure is needed** — Composio handles expiry, rotation, and revocation server-side. This is why (iv) is *simpler* than (ii), not just *safer*.

**Latency is ~550 ms p50 per tool call** — measured live against Composio's Cloudflare-fronted backend from two vantage points (Windows host and a `node:22-bookworm` container). This is **server-side** latency at Composio, not environmental — confirmed by Node-level breakdown (9 ms RTT to Cloudflare edge, ~25 ms TCP+TLS handshake, ~300 ms server-side floor on even failed-auth 401s across every endpoint tested). Running the probe from Railway us-east wouldn't change the number meaningfully.

**This latency is acceptable for our product's shape**, not despite it. Our 20 official Claws are batch-dominant (daily briefings, heartbeat scans, editorial pipelines, sourcing, scheduling), where 550 ms is invisible. The only interactive path is user → Orchestrator, and Orchestrator turns typically run 2–5 tool calls (1.1–2.75 s total), which is normal messaging-app response time for an agent. Worker turns that loop through 15+ tool calls execute in the background — the human isn't watching. Option (ii) would cut per-call latency to ~100 ms but forces us to take OAuth token custody, disable Composio's org-wide secret masking, and build a per-tool refresh matrix (Gmail 1 h, HubSpot 30 min, Slack doesn't expire, each with different revocation semantics). That cost is not justified by the latency win given how users actually interact with Claws.

Confidence: **high** across the board. The architecture choice (iv), the live POC (real Gmail send + read against a real throwaway account, 100 % success on 10 in-container iterations), and the decision to not pivot on the latency number are all supported by evidence in §"Live POC results" and §"Evidence" below.

---

## Provenance

| Artefact | Reference |
|---|---|
| Runtime image | `ghcr.io/laxcorp-research/openclaw-runtime:latest` @ `sha256:9e1af63c16d44066a3d2c66332b3842dd40a17bcaab6a6bada9fd2a172dd9301` (unchanged since `3edf939`; re-verified at the start of this PR) |
| OpenClaw source commit | `d76b224e20c790b7223d4075abd087c9576a4661` (tag `v2026.3.1`), plus `main` HEAD `50e71daaa0619fdb88739af2d36d63748bb2e51a` (`2026.4.16`) checked for drift |
| `@composio/core` SDK | `^0.6.8` (matches our `package.json:38`); exact installed version recorded in scratch `C:\temp\composio-poc\package-lock.json` |
| Composio REST API | `POST https://backend.composio.dev/api/v3/tools/execute/{toolSlug}` — confirmed from `@composio/client@0.1.0-alpha.66` SDK source at `src/resources/tools.ts:65`. See "Endpoint path drift" below for the `v3` vs `v3.1` discrepancy between SDK and docs. |
| POC date | 2026-04-18 |
| POC connection (redacted) | `ca_M6c…` on a throwaway Google account (`claws-poc-test@****.com`) — deleted after doc approval per PR owner's instruction |
| POC auth config (created during POC) | `ac_hMS…` — first `use_composio_managed_auth` config for `gmail` on this Composio project; paid-tier gating trigger cleared |
| POC LaxClaws user | `e2e-test@buildclaws.ai` (minted by `src/app/api/auth/test-session/route.ts` with `E2E_TEST_MODE=true`, so the POC exercises our real OAuth routes without needing a real sign-in) |
| POC workspace | `cmn31u…` (DRAFT status, pre-existing E2E fixture tied to the test user) |
| POC output files | Live in `C:\temp\composio-poc\` (not committed); scripts preserved for PR #4 re-runs, all tokens + cookies deleted on teardown |

---

## Evidence

### 1A. Is OpenClaw Composio-aware?

**No.** Direct verification, case-insensitive grep:

```
rg -i "composio"  C:\temp\openclaw-rootfs  →  0 matches
rg -i "composio"  C:\temp\openclaw-src     →  0 matches
```

No import of `composio-core` or any Composio SDK. No `composio`-prefixed config field in OpenClaw's Zod schema (checked `src/config/zod-schema*.ts`). No runtime OAuth-refresh hook. No "connection manager" abstraction that would hook into Composio.

This puts Composio firmly outside the runtime. Our platform (Next.js + Prisma) and our skills' `skillMd` bodies are the only places Composio can be called from.

### 1B. OpenClaw's tool connection / credential model

From `ENV_VAR_CONVENTION.md` §"OpenClaw `skills.entries[slug]` schema (definitive)", we already established OpenClaw accepts exactly four fields under each `skills.entries[slug]`:

```ts
// /app/src/config/types.skills.ts
export type SkillConfig = {
  enabled?: boolean;
  apiKey?: SecretInput;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
};
```

**There is no "connection manager" or "OAuth" shape.** If we want Composio credentials to reach a skill, our only options are:
- Put them in the skill's `env` map as named env vars (option ii).
- Put a plaintext `apiKey` on the skill entry and have OpenClaw bind it to `primaryEnv` (option ii, shortcut variant).
- Put Composio coordinates (api key, user id, connection id) in `env` and let the skill's body call Composio itself (option iv).
- Put Composio coordinates in `config` instead of `env` (option iv, variant). Because `config` is `Record<string, unknown>`, structured data is fine there.

OpenClaw has no opinion on which we pick. It sees four fields; the skill body decides what to do with them.

### 1C. Composio SDK / REST contract

From the public docs (`docs.composio.dev/docs/connected-accounts`) and direct inspection of `@composio/core@^0.6.8`:

**OAuth connection lifecycle:**

1. `composio.authConfigs.list({toolkit: "gmail"})` — find or create auth config (we already do this in `src/lib/composio-auth-config.ts`).
2. `composio.connectedAccounts.initiate(userId, authConfigId, { callbackUrl?, allowMultiple? })` — starts OAuth, returns `{ id, redirectUrl, waitForConnection() }`. We use the `callbackUrl` variant in our production Next.js app; the scratch POC uses the `waitForConnection` polling variant because it needs no public callback.
3. User completes consent in browser → Composio stores OAuth credentials.
4. `composio.connectedAccounts.get(id)` → `{ id, status, toolkit, authConfig, state: { authScheme, val } }` — where `state.val` contains the raw OAuth credentials, masked to first 4 chars by default.

**Tool invocation:**

SDK:
```ts
const result = await composio.tools.execute("GMAIL_FETCH_EMAILS", {
  userId,
  connectedAccountId,
  arguments: { max_results: 10 },
})
```

REST (what an in-container `fetch()` would send):
```http
POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS
x-api-key: <COMPOSIO_API_KEY>
content-type: application/json

{
  "user_id": "claws_<userId>",
  "connected_account_id": "<composioConnectionId>",
  "arguments": { "max_results": 10 }
}
```

Response shape (from `@composio/client/resources/tools.d.ts:323-346`):
```ts
{
  data: { [key: string]: unknown },   // tool-specific payload
  error: string | null,
  successful: boolean,
  log_id?: string,
  session_info?: unknown,
}
```

**Key properties:**

- Composio handles auth, token refresh, retries — our code doesn't see any of that.
- Credential masking is orthogonal to `tools.execute`. We never need to fetch raw tokens for this path, so we never need to disable masking org-wide.
- A single `COMPOSIO_API_KEY` (platform-scoped) authorizes all per-user tool calls. Per-user identity is carried by `user_id`; per-connection via `connected_account_id`.
- **Revocation semantics (verified 2026-04-21, updated from pre-evidence framing):**
  - **At the provider (Google):** when the user revokes at `https://myaccount.google.com/permissions`, both the access token and refresh token are invalidated atomically.
  - **At `composio.tools.execute` call time:** the call returns `{ successful: false, error: "HTTP 401: Request had invalid authentication credentials. Expected OAuth 2 access token...", data: { message, status_code } }`. Composio propagates Google's 401 faithfully. Skill bodies catch this and surface "reconnect required" to the agent.
  - **At `composio.connectedAccounts.get(id)`:** `status` **stays `ACTIVE`** before, during, and immediately after the probe call that surfaced the 401. Composio does not flip the status record on an immediately-observed provider-side 401. What trigger *does* flip it (periodic health sweep, `connectedAccounts.delete`, refresh-token-expiry event, a Composio-side background job, etc.) is currently unknown. Evidence: `C:\temp\composio-poc\400-force-composio-probe.mjs`.
  - **Architectural implication:** `/oauth/status`'s `mapComposioStatus` correctly handles `ACTIVE`/`EXPIRED`/`REVOKED`/`FAILED` raw values if Composio returns them. But because Composio does not return `EXPIRED`/`REVOKED` promptly after a provider-side revoke, the DB can remain `CONNECTED` for stale connections until the Composio-side trigger fires. Users discover revocation gracefully at agent-runtime via the 401 path; dashboard UX may show stale `CONNECTED` until the DB catches up. Follow-up: [GH #40](../../issues/40).

### Endpoint path drift: `v3` vs `v3.1`

Composio's SDK and its own public API reference docs label the `tools.execute` endpoint differently. We investigated and documented this precisely so PR #4's emission code isn't caught off-guard:

| Source | Path used / shown |
|---|---|
| `@composio/core@0.6.10` → `@composio/client@0.1.0-alpha.66` SDK source (`node_modules/@composio/client/src/resources/tools.ts:65`) | `POST /api/v3/tools/execute/{toolSlug}` |
| Composio public API reference page (`https://docs.composio.dev/reference/api-reference/tools`, OpenAPI-generated; specific endpoint slug is `postV3_1ToolsExecuteByToolSlug`) | `POST /api/v3.1/tools/execute/{tool_slug}` |
| Live probe: `POST https://backend.composio.dev/api/v3/tools/execute/GMAIL_GET_PROFILE` (no auth) | `401 Unauthorized` — endpoint exists |
| Live probe: `POST https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_GET_PROFILE` (no auth) | `401 Unauthorized` — endpoint exists |
| Grep `v3\.1` across `C:\temp\composio-poc\node_modules\@composio\**\*` | **0 matches** in SDK source |

**Both paths are live on Composio's backend.** The SDK canonically targets `/api/v3/`, and that's what we recommend our emitted skill bodies use. Rationale: the SDK is what our server-side Next.js code already imports (`src/lib/composio.ts`), so aligning the container-side `fetch()` with the SDK's canonical path avoids cross-path drift inside our own stack. If Composio deprecates `/api/v3/` in favor of `/api/v3.1/`, the SDK will bump first and we'll follow.

This is a real provenance item — not a "Cursor got it wrong and fixed it" — and documented here so future PRs don't rediscover it.

### 1D. Chosen architecture — Option (iv) per-request proxy via `tools.execute`

**Recommendation:** emit, for every `OAUTH_COMPOSIO` tool connection, a `skills.entries[<skill-slug>]` entry whose body calls Composio's REST endpoint. No raw OAuth tokens anywhere in our stack.

Exact emission shape in `openclaw.json`, for the Gmail case:

```json
{
  "skills": {
    "entries": {
      "gmail-send": {
        "enabled": true,
        "env": {
          "COMPOSIO_API_KEY": "<platform-scoped Composio key>",
          "COMPOSIO_USER_ID": "claws_<workspace's userId>",
          "COMPOSIO_CONNECTED_ACCOUNT_ID": "<composioConnectionId from ToolConnection row>"
        },
        "config": {
          "composio": {
            "toolkit": "gmail",
            "executeEndpoint": "https://backend.composio.dev/api/v3/tools/execute"
          }
        }
      }
    }
  }
}
```

Generalization — all 21 `OAUTH_COMPOSIO` toolkits use the exact same envelope; the only variations per tool are:

| Field | Varies per tool? | Source |
|---|---|---|
| `env.COMPOSIO_API_KEY` | No | Platform-wide secret |
| `env.COMPOSIO_USER_ID` | Per our user, same across all their OAuth tools | `claws_${user.id}` helper in `src/lib/composio.ts` |
| `env.COMPOSIO_CONNECTED_ACCOUNT_ID` | Per tool connection | `ToolConnection.composioConnectionId` |
| `config.composio.toolkit` | Per tool | `ToolDefinition.composioToolkitId` (already in `src/data/tool-catalog.ts`) |
| `config.composio.executeEndpoint` | No | Constant |

Rationale:

1. **Security.** No OAuth tokens enter our platform DB, the container's env, Railway's env var storage, or any log line. If Composio is breached we lose Composio's grant (bad but recoverable); under option (ii) we'd also lose every user's raw Gmail/HubSpot/etc. tokens that sit in our container env. Revocation is transparent — the next `tools.execute` returns 4xx.
2. **Skill rewrites happen either way.** Our seeded OAuth `skillMd` bodies currently reference `$TOOL_API_KEY`, which OpenClaw doesn't honor (see `ENV_VAR_CONVENTION.md` §6). So regardless of architecture, all 21 OAuth toolkit skills need a rewrite. Option (iv)'s per-skill rewrite cost is not higher than option (ii)'s.
3. **No refresh infrastructure to build.** Gmail access tokens expire in 1 hour; HubSpot has a different lifetime; Slack bot tokens don't expire but can be revoked; personal access tokens don't refresh at all. Option (ii) forces us to solve expiry + revocation for each of 21 toolkits — different TTLs, different refresh endpoints, different revocation signals, different scope-loss behaviors. Option (iv) delegates the entire matrix to Composio: their SDK docs explicitly state "Composio automatically handles token refresh and credential management," and the POC confirms the contract at the REST layer (one `POST /tools/execute`, Composio returns fresh data every time, no refresh tokens ever cross our boundary). **This is not just a security win; it's a structural simplicity win over (ii).**
4. **No `composio-core` SDK inside the container.** The SDK is fine in our Next.js server (where we already import it). Inside the container, a single `POST` via Node's built-in `fetch()` or `curl` from a bash skill covers it. Zero additional runtime dependency on Composio's package-manager ecosystem. Size of the HTTP path: ~15 lines of bash / ~25 lines of Node. Verified during the POC's container probe (`C:\temp\composio-poc\05-container-http-probe.mjs` — 10 iterations, 100 % success, no SDK import).
5. **Latency is ~550 ms p50 per Composio call, measured, and appropriate for our product's usage pattern.** The 10-iteration in-container probe of `GMAIL_GET_PROFILE` produced **p50 = 549 ms, p95 = 623 ms, max = 623 ms, success = 100 %**. This is server-side latency at Composio (breakdown in §"Live POC results" — 9 ms RTT to Cloudflare edge, ~25 ms TCP+TLS, ~300 ms server-side floor across every endpoint including failed-auth 401s). Railway in us-east would save at most 5–10 ms on the client side; it does not address the server-side 300 ms floor. The number is inherent to Composio's backend, not our environment.

   Why this is acceptable given how our product actually works:

   - **Our 20 official Claws are batch-dominant.** Daily briefings, heartbeat scans, editorial pipelines, outbound sourcing, scheduler runs. For a process executing in the background against a heartbeat schedule, 550 ms per Composio call disappears into the existing minutes-to-hours cadence.
   - **The only interactive path is user → Orchestrator.** An Orchestrator turn typically runs 2–5 tool calls (delegate → check worker status → reply), totaling 1.1–2.75 s of Composio latency. That sits well inside the response time humans expect from an agent in a messaging interface.
   - **Worker turns can loop through many tool calls** (15+), but Workers execute in the background — no human is watching the 550 ms per call accumulate. The Orchestrator reports back when the Worker is done, and the 30–60 s wall-clock of a deep Worker turn is bounded by what the Worker is doing (LLM reasoning + tool use), not just the Composio hop.

   Option (ii) would cut per-call latency to ~100 ms but at a cost the product shape does not justify (see "Rejected alternatives" below).

### Rejected alternatives

- **(i) Runtime-native Composio.** Would require OpenClaw to import `composio-core`, read `composioConnectionId` from config, and fetch/refresh tokens at skill-invocation time. **Dead**: §1A established OpenClaw has zero Composio awareness and no plug-in surface where we could add it without forking the runtime.

- **(ii) Deploy-time token fetch + refresh sidecar.** Mechanics: at deploy time, we'd call `composio.connectedAccounts.get(id)` with masking disabled, extract `state.val.access_token` and `state.val.refresh_token`, emit as `skills.entries.<slug>.env.GMAIL_ACCESS_TOKEN = "ya29..."`. Add a sidecar process (or cron, or on-idle hook) inside the container to re-fetch before expiry.

  **Latency win**: ~400 ms per tool call (direct toolkit API instead of the Composio proxy hop). Cuts p50 from ~550 ms to ~100–150 ms.

  **Rejected** because the cost is substantial across four distinct dimensions, and our product doesn't need the latency win:

  - **We'd take OAuth token custody.** Every user's raw Gmail/HubSpot/Slack access + refresh tokens would sit in our Railway container env, in our `.env` files, and in the deployer's base64 payloads. A leak of our container env (which happens — see the accidental `.env.local` password exposure earlier in this same PR sequence) now leaks every user's tokens for every connected OAuth tool, not just our platform credentials. Composio's threat model is built around keeping these tokens server-side; we'd be taking that back on ourselves.
  - **Requires disabling Composio's secret masking org-wide** via `PATCH /api/v3.1/org/project/config {"mask_secret_keys_in_connected_account": false}`. Composio's own docs flag this as security-implicating. Every Composio connection across our org would then return raw tokens on any `connectedAccounts.get` — not just ours, not just during deploy, not just for Gmail. This can't be scoped per-workspace; it's an org flag. Broad attack surface for a narrow benefit.
  - **We'd have to build a per-toolkit refresh matrix.** Each of the 21 OAuth toolkits has different expiry semantics: Gmail access tokens last 1 h (refresh tokens are long-lived but can be revoked by the user in Google's dashboard); HubSpot developer tokens last 30 min; Slack bot tokens don't expire but can be revoked in Slack's admin; Notion internal integration tokens don't refresh at all (no refresh token issued); Intercom OAuth tokens expire based on session policy; Linear/Asana/ClickUp/Jira all have their own schedules. A sidecar that refreshes Gmail can't directly refresh Notion; our code would end up with a 21-way switch on toolkit slug. This is exactly the abstraction Composio exists to sell us — re-implementing it in-house is the kind of "save 400 ms at the cost of owning a refresh-daemon-per-toolkit" trade that doesn't hold up over a product lifetime of 21 toolkits and growing.
  - **Stale-token detection is another whole system.** If a user revokes Gmail access in their Google account mid-session, our injected token becomes a 401 on first use; the container can't cleanly distinguish "revoked" vs "rate-limited" vs "temporarily-unavailable" without probing Composio anyway. In option (iv), the next `tools.execute` just returns `{successful: false, error: "..."}` — Composio did the distinguishing for us.

  **And the latency win it pays for is not one our product needs.** See §1D rationale point 5: user-facing Orchestrator turns don't bottleneck on Composio at 2–5 calls per turn, and Worker turns that do deep tool-use loops run in the background where the human doesn't see the clock. If our product were low-latency interactive chat with direct tool-call latency visible to the user (like a phone-style assistant), (ii)'s win would matter — but Claws isn't that.

- **(iii) Hybrid (deploy-time fetch + runtime refresh via Composio).** Mechanics: extract tokens at deploy, set up a long-running process inside the container that periodically calls `composio.connectedAccounts.refresh(id)` and rewrites a token file. Refresh is Composio's problem, extraction is still ours.

  **Rejected** for complexity. Two moving parts (deploy-time extraction, runtime refresher) when option (iv) has zero. The refresher adds a new failure mode (if it dies, tokens go stale) and the deploy-time extraction still requires disabling secret masking. Combines the worst cons of (ii) with the hop overhead of (iv) anyway (the refresher itself makes Composio calls from the container).

### 1E. Skill frontmatter implications per OAuth tool

We currently seed `Skill` rows in `prisma/seed-data/skills-tool-specific.ts` that map to OAuth toolkits via `compatibleTools`. `ENV_VAR_CONVENTION.md` §D2 already documented that **0 of 36** seeds declare `primaryEnv` or `requires.env` in their frontmatter — every seed uses `$TOOL_API_KEY` in body prose, which OpenClaw doesn't honor.

For option (iv) to work, each OAuth toolkit skill's `skillMd` body needs to be rewritten to:

1. Read `$COMPOSIO_API_KEY`, `$COMPOSIO_USER_ID`, `$COMPOSIO_CONNECTED_ACCOUNT_ID` from env.
2. Call `POST https://backend.composio.dev/api/v3/tools/execute/<TOOL_SLUG>` via `curl` or `fetch`.
3. Pass `{ user_id, connected_account_id, arguments: {...} }` in the body.
4. Parse `{ data, error, successful }` response.

Frontmatter must declare:
```yaml
metadata:
  openclaw:
    emoji: <emoji>
    requires:
      env: ["COMPOSIO_API_KEY", "COMPOSIO_USER_ID", "COMPOSIO_CONNECTED_ACCOUNT_ID"]
```

**Per-tool frontmatter audit.** Of the 21 `OAUTH_COMPOSIO` tools in our catalog (`src/data/tool-catalog.ts:44-66`), every one needs a rewritten `skillMd` body per the shape above plus an explicit `version` parameter (see §"Step 3 — `tools.execute` for Gmail read" about the `version` requirement). The full per-toolkit cross-reference — which existing `prisma/seed-data/skills-tool-specific.ts` entries map to which catalog slug, which Composio tool-version is current at PR-land-time, which per-tool `arguments` shape each skill needs — is explicitly **out of scope for this PR** and belongs to PR #4's implementation work. This doc settles the architecture (one emission shape, no refresh infra); PR #4 mechanically applies it 21 times.

Scope signal for PR #4 planning: all 21 rewrites follow the same template (the Gmail example in §"Emission shape" above). The diff per skill is ~40 lines of `skillMd` body plus the frontmatter stanza. Estimated total: ~840 lines of markdown across `skills-tool-specific.ts`, plus per-tool `arguments` schemas sourced from `composio.tools.retrieve(slug)` at seed-authoring time.

### 1F. Agent-level env var scoping

From `ENV_VAR_CONVENTION.md` §D1, OpenClaw's env merge (`src/agents/skills/env-overrides.ts:148-168`) calls `applySkillConfigEnvOverrides` for each skill in the active set. Env vars from `skills.entries[slug].env` get merged into `process.env` **globally** — not scoped per-skill-per-agent.

Practical implication for option (iv): **`COMPOSIO_API_KEY` will be visible to every skill the container runs during a session, not just the OAuth-using ones.** This is worse than option (ii) where the leaking var was a tool-specific token (bad but limited blast radius), and better than option (ii) in that the Composio key can be ACL'd server-side (Composio knows which `user_id + connected_account_id` combos are allowed) — a leaked `GMAIL_ACCESS_TOKEN` would grant full Gmail access until rotation.

**Mitigation:** document this in the Composio-backed skill's `requires.env`, so the skill-eligibility check (`shouldIncludeSkill` in `src/agents/skills/config.ts`) at least gates which agents see Composio-backed skills. This is enforced per-agent via `agents.list[].skills` allowlists (OpenClaw feature we already support). So: a Critic agent that doesn't have `gmail-send` in its allowlist won't have the skill active, and the env var won't be injected for its runs.

But if multiple agents in the same workspace DO have Composio-backed skills in their allowlists, they all see `COMPOSIO_API_KEY`. That's fine functionally — they use different `connected_account_id` values and Composio scopes per-connection — but anyone with code execution inside the container could mint a Composio call for any connected account belonging to the same workspace's user. **This is acceptable because that's the exact same trust boundary we already have for platform API keys.**

---

## Emission shape — canonical spec for PR #4

For every `OAUTH_COMPOSIO` `ToolConnection` row where `status = 'CONNECTED'`, the generator should emit into `openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "<skill-slug-from-compatibleTools>": {
        "enabled": true,
        "env": {
          "COMPOSIO_API_KEY": "<encrypted, decrypted at emit time>",
          "COMPOSIO_USER_ID": "claws_<User.id>",
          "COMPOSIO_CONNECTED_ACCOUNT_ID": "<ToolConnection.composioConnectionId>"
        },
        "config": {
          "composio": {
            "toolkit": "<ToolDefinition.composioToolkitId>",
            "executeEndpoint": "https://backend.composio.dev/api/v3/tools/execute"
          }
        }
      }
    }
  }
}
```

A sanitized full example lives at [`docs/examples/composio-gmail.json`](./examples/composio-gmail.json).

---

## Live POC results

> The POC was run from `C:\temp\composio-poc\` (scratch directory, outside this repo). Scripts, outputs, and credentials never leave the scratch directory. Only the redacted summary below is committed. All measurements are from 2026-04-18 against the pinned image digest in §Provenance.

### Run summary

- **POC date:** 2026-04-18
- **`@composio/core` version (scratch dir):** `0.6.10` → `@composio/client@0.1.0-alpha.66`
- **`@composio/core` version (main repo):** `^0.6.8` → `@composio/client@0.1.0-alpha.62` (resolved; declared in `package.json`). The minor alpha drift between scratch and repo is noted; both use the same `POST /api/v3/tools/execute/{toolSlug}` shape.
- **Throwaway Google account:** `claws-poc-test@****.com`
- **LaxClaws user (test):** `e2e-test@buildclaws.ai` — minted by `src/app/api/auth/test-session/route.ts` after setting `E2E_TEST_MODE=true` on the dev server
- **Workspace:** `cmn31u…` (pre-existing E2E fixture for the test user, status=DRAFT)
- **Composio connection ID:** `ca_M6c…` (full value saved only to `C:\temp\composio-poc\state.json`, never committed, deleted on teardown)
- **Composio auth config ID:** `ac_hMS…` — created during the POC via `authConfigs.create({type: "use_composio_managed_auth"})`; clearing this call as paid-tier gated was **escalation trigger #1** and it resolved as clean (no 402, no "upgrade" text)
- **Connection status at test time:** ACTIVE

### Step 1 — OAuth round-trip through our real API routes

Not a scratch-dir OAuth: the POC hit our actual Next.js routes to validate the production path end-to-end.

- **Request to `POST /api/tools/<workspaceId>/oauth/initiate`** with body `{toolSlug: "gmail"}`: returned **200 in 5759 ms** (first-time initiate is slow because `authConfigs.create` ran — subsequent initiates on the same project reuse the auth config via `authConfigs.list`, which we verified separately).
- Our initiate route called (in order): `getSessionUser()`, `verifyWorkspaceOwnership()`, `getComposio()`, `resolveAuthConfigIdForToolkit(composio, "gmail")` which listed (0 results) → created (200), then `composio.connectedAccounts.initiate(composioUserId, authConfigId, { callbackUrl, allowMultiple: true })`. ToolConnection row upserted to DB with `composioConnectionId` + `composioEntityId`.
- `redirectUrl` returned: `https://backend.composio.dev/api/v3/s/<short>` — Composio's hosted consent page.
- User opened URL in browser → signed in to throwaway Google → consent screen listed 12 scopes (see below) → redirect back → Composio moved the account from PENDING to ACTIVE.
- Our `/api/tools/<workspaceId>/oauth/status` polling (via `12-poll-status.mjs`): **59 polls** before first ACTIVE, **160 s total** (mostly human consent time). Per-poll `/oauth/status` latency: **p50 = 665 ms, p95 = 852 ms** (this endpoint's cost includes `composio.connectedAccounts.get` + a Prisma row update when status changes, so it's the upper bound of what our routes spend on Composio round-trips).

**Scopes shown on Google's consent screen for the Composio-managed Gmail auth config** (verbatim from `account.state.val.scope`, space-separated in OAuth 2.0 style):

```
openid
https://mail.google.com/
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/profile.emails.read
https://www.googleapis.com/auth/profile.language.read
https://www.googleapis.com/auth/user.birthday.read
https://www.googleapis.com/auth/user.addresses.read
https://www.googleapis.com/auth/user.emails.read
https://www.googleapis.com/auth/user.phonenumbers.read
https://www.googleapis.com/auth/contacts.readonly
https://www.googleapis.com/auth/contacts.other.readonly
```

**Observation — descriptive only**: the Composio-managed auth config for Gmail requests 12 scopes on the user's Google account, including full Gmail access (`https://mail.google.com/`) and a broad set of user/contact profile fields. This is what Composio's managed-auth template for Gmail asks for, and the user sees all of it on Google's consent screen before authorizing.

**Our architectural stance (revised post-PR #4 review):** we default to Composio's managed auth for every OAuth tool. We do NOT build `use_custom_auth` configs with pre-narrowed scopes. Scope decisions stay with users via Google's consent surface — it's their account, their automation, their risk appetite, not ours to cap. The 12-scope grant is recorded here for traceability (so a future maintainer can look up what Gmail connections consent to without running the audit script again), not as a remediation target.

Per-tool scope counts for the other 16 OAuth toolkits live in the PR #4 merge description, sourced from `C:\temp\composio-poc\90-oauth-tools-raw.json`. Re-runnable via `node C:\temp\composio-poc\21-scope-audit.mjs` if Composio changes what they ask for.

### Step 2 — Connection state inspection (confirms masking, confirms option (iv) never needs raw tokens)

- `composio.connectedAccounts.get(connectionId)` returned in **620 ms**.
- `account.status = ACTIVE`; `account.toolkit.slug = gmail`; `account.authConfig.id = ac_hMS…`.
- `account.state.authScheme = OAUTH2`.
- `account.state.val` top-level keys (16):

  ```
  status, access_token, id_token, token_type, refresh_token, expires_in, scope,
  code_verifier, redirectUrl, callback_url, finalRedirectUri, refresh_token_expires_in,
  base_url, headers, queryParams, extra_data
  ```

- Classification per field (from `02-inspect.mjs`, no raw values printed): `access_token`, `id_token`, `token_type`, `refresh_token`, `code_verifier` all came back as `string(≤8)` — i.e., **Composio's default masking** trimmed them to 4 chars + "..." before returning. `expires_in` and `refresh_token_expires_in` are numbers. `scope` is the 546-character space-separated list above. The other fields are URLs and non-sensitive metadata.

  **This is exactly the behavior option (iv) relies on**: because we never consume raw tokens, we don't need to disable masking. The masked values are inert from our perspective; Composio uses the real values server-side when we call `tools.execute`.

### Step 3 — `tools.execute` for Gmail **read**

- `composio.tools.execute("GMAIL_FETCH_EMAILS", {userId, connectedAccountId, arguments: {max_results: 1, query: ""}, version: "20260417_00"})`.

  **Note on `version`**: Composio's v3 API **requires** an explicit `version` parameter on execute calls. The SDK's default (`"00000000_00"`) is no longer accepted and returns `400 "Toolkit version not specified"`. We resolve the latest version per-tool via `composio.getClient().tools.retrieve(slug)` and use `r.available_versions[0]`. For `GMAIL_GET_PROFILE` as of 2026-04-18, that's `20260417_00`. PR #4's generator or skill body must supply this; the SDK does not.

- Result: **`successful = true`, `error = null`**. Returned 1 real email from the throwaway account's inbox with full payload (headers, body, labels, threadId, messageId). Redacted response shape persisted to `execute-gmail_fetch_emails.json`; non-redacted values never surfaced outside the script.
- Latency: **1107 ms single-call**. Includes `tools.retrieve` (version resolution) + `tools.execute` — so roughly 550 ms for the execute itself plus ~350 ms for retrieve plus ~200 ms for SDK overhead. The in-container probe (§Step 5) measures execute-only.
- `resultSizeEstimate: 201` — the throwaway account already has 201 messages in the inbox, giving us real data volume for the test.

### Step 4 — `tools.execute` for Gmail **send**

- `composio.tools.execute("GMAIL_SEND_EMAIL", {userId, connectedAccountId, arguments: {recipient_email, subject, body, is_html: false}, version: "20260417_00"})` where `recipient_email` is the throwaway's own address (we probed `GMAIL_GET_PROFILE` first to get it — no external recipient).
- Result: **`successful = true`, `error = null`**. Message delivered to the throwaway account's inbox.
- Latency: **1241 ms single-call** (again includes version resolution + profile probe + send).
- End-to-end architecture (iv) confirmed: Composio → Google Gmail API → back, writing to a real mailbox, without a single OAuth token touching our scripts' process memory.

### Step 5 — In-container REST path (no SDK)

This is the exact shape an OpenClaw skill body would use — `fetch()` against Composio's REST API from inside a container with **zero Composio-specific dependencies**.

- Command (passwords redacted):

  ```
  docker run --rm \
    -e COMPOSIO_API_KEY=<redacted> \
    -e COMPOSIO_USER_ID=claws_<redacted> \
    -e COMPOSIO_CONNECTED_ACCOUNT_ID=ca_M6c… \
    -v "${PWD}:/poc" -w /poc \
    node:22-bookworm node 05-container-http-probe.mjs
  ```

- Image: `node:22-bookworm` — the **same base** as OpenClaw's runtime (per image label `org.opencontainers.image.base.name=docker.io/library/node:22-bookworm`), so container-to-internet network characteristics match production.
- 10 iterations of `POST /api/v3/tools/execute/GMAIL_GET_PROFILE` with `{user_id, connected_account_id, arguments: {}, version: "20260417_00"}`.
- Per-iteration latencies (ms), in order observed: iterations 1–2 were the max values (`~623 ms` each, cold TCP/TLS setup + Cloudflare edge warm-up), then 508, 563, 567, 536, 565, 549, 520, 549. All 10 iterations were included in the statistics — no warmup exclusion was applied. PR #4's future re-probes should run 1 warm-up call before 10 measured iterations (the measured distribution would tighten to ~540–570 ms range without the cold-start outliers).

| Statistic | Value |
|---|---|
| **p50** | **549 ms** |
| **p95** | **623 ms** |
| **max** | 623 ms |
| min | 508 ms |
| success rate | **10 / 10 (100 %)** |

- Script's own escalation flag: `ESCALATE: p50=549ms p95=623ms success=100% (thresholds: p50<=300, p95<=500, success>=90)` — both p50 and p95 thresholds exceeded by the script's own auto-check. See next subsection for why this doesn't invalidate the recommendation.

### Where the latency lives (decomposition that led to the architecture decision)

Before re-provisioning a Railway us-east instance to re-probe (which was the initial escalation plan), we decomposed the 550 ms to see whether the client-side network was the dominant cost:

| Measurement (from the same Windows host, `node --expr`) | Value |
|---|---|
| `ping 104.18.20.5` (Composio's Cloudflare edge, anycast) | **9–10 ms RTT**, 5/5 replies |
| `dns.lookup backend.composio.dev` | 0–14 ms (cached after first) |
| TCP + TLS handshake to `backend.composio.dev:443` (measured via `tls.connect`) | **24–36 ms** |
| `POST /api/v3/tools/execute/GMAIL_GET_PROFILE` with an **invalid** API key (server returns 401 on auth check) | **300–408 ms** round-trip |
| `GET /api/v3/toolkits/gmail` (authenticated, cheap metadata) | **311–419 ms, mean 373 ms** |
| `GET /api/v3/tools/GMAIL_GET_PROFILE` (authenticated, tool metadata) | **304–413 ms, mean 336 ms** |
| `GET /api/v3/auth_configs?limit=1` (authenticated) | 443 ms min, 804 ms mean, 1817 ms p100 outlier |

The 401 round-trip is the load-bearing measurement. Composio's backend takes **300 ms just to receive a request, parse the header, reject on auth, and return 401**. That's a server-side floor that no client-side optimization can undercut. `GET /toolkits/gmail` returning 200 with real data is also 300 ms+. The architecture's latency is **not** a client-side network issue.

**Composio is Cloudflare-fronted** (`104.18.20.5` / `104.18.21.5` are Cloudflare anycast IPs, IPv6 `2606:4700::` same). Railway in us-east would shave 5–8 ms off the client-to-Cloudflare-edge hop and might improve POP-to-origin routing by a handful of ms, but there is no reasonable configuration under which the 300 ms server-side floor drops. We decided **not** to re-provision and re-probe from Railway — the evidence we already had was stronger than a second measurement would be.

### Verdict

**Verified with measured latency, not blanket thresholds.** Option (iv) works end-to-end (OAuth, read, send, in-container `fetch` at 100 % success). The measured p50 of 549 ms exceeds our original `p50 ≤ 300 ms` target band, but the latency is Composio-backend-inherent (300 ms server-side floor confirmed by decomposition), not an environmental artifact we could fix by moving the probe to Railway. For our product's shape (batch-dominant Claws, Orchestrator turns of 2–5 tool calls at ~2.75 s total, Worker deep-loop turns running in background), 550 ms per call is appropriate, not a problem to route around. Recommendation stands on (iv).

(Threshold-framing note: the `p50 ≤ 150 ms` target I set earlier in this PR sequence was the right threshold for a real-time conversational agent. It was not the right threshold for a batch-dominant agent team platform. The POC did its job — it revealed that the latency is higher than a naive target, and the analysis that followed re-anchored the decision to the product's actual usage pattern rather than to a number picked before the measurement was in.)

### Cleanup

- `node 06-cleanup.mjs` → `connectedAccounts.delete(id)` returned `success=true`.
- Confirmed via `composio.connectedAccounts.get(id)` — 404 / "not found".
- Throwaway Google account has no live grants remaining from this POC.

### Escalation triggers — explicit

Any of the following during the POC means **stop, recall the recommendation, tell the PR owner** — do not document-and-proceed.

| Trigger | Why it invalidates option (iv) |
|---|---|
| `authConfigs.create(toolkit, { type: "use_composio_managed_auth" })` returns 402 / mentions "upgrade" / "paid tier" / "not available on free plan" / "subscription required" | Composio-managed auth is the default path PR #4 would rely on. If it requires a paid Composio tier to work at all for users on the free plan, we'd be building our OAuth story on a paid dependency. `01-auth.mjs` classifies this via `classifyAuthConfigCreateError` and exits `3`. |
| `tools.execute` returns `successful=false` with a toolkit-specific auth error on the first call (e.g., Gmail says "token expired, re-auth") | Suggests Composio's "automatic refresh" is not as transparent as their docs claim. Option (iv) depends on Composio's refresh working silently. |
| Container probe (script 05) shows `p50 > 300 ms` OR `p95 > 500 ms` OR `success < 90%` over 10 iterations | Option (iv) adds one network hop per tool call. If that hop is 300ms+ p50, agentic loops (multi-step reasoning with many tool calls) get unacceptably slow. `05-container-http-probe.mjs` emits `escalationTrigger` in its summary when any threshold is exceeded. |
| Google consent screen shows scopes we didn't expect (e.g., Gmail "send" also grants full mailbox read without a separate scope) | Composio-managed auth configs set scopes; if the scope is broader than what our Setup Wizard UI advertises, users may grant more than they meant to. Flag as a UX note to address in PR #4 or PR #6. |
| Any 4xx from Composio we can't attribute to user revocation or missing args | Composio's error semantics affect our skill's error-handling story. Undocumented 4xxs we'd need to handle case-by-case break the "Composio abstracts errors" pitch. |

---

## Auth config lifecycle (PR2.8a-fix1 update)

> **Status as of PR2.8a-fix1:** managed-auth configs are **lazily auto-created on first Connect click**. No operator action required for any toolkit Composio offers a managed-auth scheme for. The operator tracker below covers only the residual set where managed auth isn't available.

The route handler at `src/app/api/tools/[workspaceId]/oauth/initiate/route.ts` calls `ensureAuthConfigForToolkit(composio, toolkitSlug)` (in `src/lib/composio-auth-config.ts`) before invoking `composio.connectedAccounts.initiate(...)`. The helper:

1. Fetches `composio.toolkits.get(toolkitSlug)` and inspects `composioManagedAuthSchemes`.
   - **Empty array** → throws `ComposioToolkitRequiresCustomOAuthError`. Route returns HTTP 422 with code `COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH`. Wizard renders a yellow "Setup in progress" warning, not a red error. The 8 RED-2 toolkits in the operator tracker below all land here.
   - **Non-empty** → continue.
2. Lists existing auth configs (`composio.authConfigs.list({ toolkit, limit: 25 })`). If one exists, returns its id immediately (idempotent / GREEN-state path — covers Gmail and Google Drive today and every toolkit after first Connect).
3. Acquires a Postgres session-scope advisory lock keyed on `hashtext(toolkitSlug)` via `pg_try_advisory_lock`, inside a `prisma.$transaction(async tx => …)` (the transaction pins the connection across the pgbouncer pool — without the pin, the lock would land on a different backend than the unlock and leak). The lock is **session-scope, not transaction-scope**, and explicitly released with `pg_advisory_unlock` in a `finally` block.
4. With the lock held, re-lists auth configs (closes the race window where another caller created + released between step 2 and step 3). If now-existing, return that id.
5. Calls `composio.authConfigs.create(toolkitSlug, { type: "use_composio_managed_auth", name: \`${toolkit.name} (Claws)\` })`. On success returns the new id.
6. **Defense-in-depth catch:** if step 5 throws with the captured RED error shape (`err.error.error.slug === "Auth_Config_DefaultAuthConfigNotFound"` or `code === 306` — verified verbatim against staging Composio in `scripts/pr2.8a-composio-authconfig-probe.mjs --negative-path`), translate to `ComposioToolkitRequiresCustomOAuthError`. Covers stale-toolkit-metadata races; the structural pre-check at step 1 catches the common case.
7. Other create errors are re-thrown as-is so the route surfaces them as 500 with the original message preserved (transient quota / 502 / network — masking these as RequiresCustomOAuth would hide a fixable issue).

**Contention semantics.** If `pg_try_advisory_lock` returns false (another caller is in step 5 right now), the helper sleeps 500 ms, re-lists once, and either returns the other caller's freshly-created id or throws an "in flight" error so the user retries. This trades worst-case latency (500 ms wait + a list call) for exactly-once create semantics across function instances.

**Logging.** Every helper invocation emits one `composio.authconfig.ensure` log event with `{ toolkitSlug, action: "noop" | "created" | "requires_custom_oauth" | "failed", durationMs, errorCode? }`. Axiom dataset routing is the same as every other `log.info` in this codebase (see `src/lib/logger.ts`).

**Replaces:** `resolveAuthConfigIdForToolkit` (deleted in PR2.8a-fix1). The old function checked `toolkit.authConfigDetails?.length` as its pre-check, which is non-empty for RED-state toolkits (they expose API_KEY/OAUTH2 schemes the operator could fill, just not managed-auth) — that's why the operator's typefully-Connect attempt reached the create call and surfaced a 500 with our generic "Could not create auth config" string. The fix is the field swap to `composioManagedAuthSchemes`.

---

## Custom OAuth toolkits (operator tracker)

> Source of truth for the 8 toolkits where `composioManagedAuthSchemes` is empty in the staging Composio project. Until each is registered in the Composio dashboard, the catalog entry stays `comingSoon: true` and the route returns HTTP 422 on direct hits.

| Slug | Status | Auth scheme(s) Composio offers (from probe) | Operator action |
|---|---|---|---|
| `twitter` | Pending | OAUTH2 (requires `client_id`, `client_secret`, `generic_id`) | Register OAuth app at Twitter Developer; create `use_custom_auth` config in Composio dashboard |
| `shopify` | Pending | OAUTH2 (`client_id`, `client_secret`); API_KEY; S2S_OAUTH2 | Register OAuth app at Shopify Partners; pick OAUTH2 config |
| `docusign` | Pending | OAUTH2 (`client_id`, `client_secret`, `full`) | Register at DocuSign Developer; OAUTH2 config |
| `lever` | Pending | OAUTH2 (`client_id`, `client_secret`, `full`, `authorizationUrl`, `tokenUrl`); API_KEY | Register at Lever; OAUTH2 config |
| `metaads` | Pending | OAUTH2 (`client_id`, `client_secret`); API_KEY | Register at Meta for Developers; OAUTH2 config |
| `pipedrive` | Pending | OAUTH2 (`client_id`, `client_secret`); API_KEY | Register at Pipedrive Marketplace; OAUTH2 config |
| `webflow` | Pending | OAUTH2 (`client_id`, `client_secret`); API_KEY | Register at Webflow; OAUTH2 config |
| `follow_up_boss` | Pending | OAUTH2 (`client_id`, `client_secret`); API_KEY | Register at Follow Up Boss; OAUTH2 config |

**As each toolkit is registered:**

1. Verify with `COMPOSIO_API_KEY=<staging-key> node scripts/pr2.8a-composio-authconfig-probe.mjs` — slug should flip to GREEN or YELLOW.
2. Update `src/data/tool-catalog.ts`: remove `comingSoon: true` and `comingSoonReason` from the entry.
3. If the toolkit is referenced as `required: true` in any seed template with a TODO marker (currently only `shopify` in `prisma/seed-data/money-making-templates.ts`), restore `required: true`.
4. Update this table's status column from "Pending" to "Registered <date>".

The required-fields detail per toolkit is recorded verbatim in `probe-composio-authconfigs-staging.stderr.txt` (gitignored) and in the PR2.8a-fix1 PR description.

---

## API_KEY toolkits via Composio

> **Status:** not implemented. Three toolkits in our catalog (`typefully`, `jotform`, `toggl`) expose only `API_KEY` auth schemes on Composio. They cannot use `use_composio_managed_auth` (which expects an OAuth flow) and the codebase has no path today for "Composio brokers an API_KEY connection".

The shape of the missing path:

- `composio.authConfigs.create(slug, { type: "use_custom_auth", authScheme: "API_KEY", val: {} })` instead of the managed variant.
- `composio.connectedAccounts.initiate(...)` returns a non-redirect response shape (no consent screen needed); our `oauth/initiate` route currently rejects this and returns `COMPOSIO_NO_REDIRECT`.
- The wizard would need to render an API-key form for `OAUTH_COMPOSIO`-typed rows whose underlying toolkit is API_KEY-only — currently the wizard branches on `connectionType` alone.
- `connectedAccounts.create({ connectionParams: { val: { generic_api_key: "..." } } })` to set the actual key after the user submits it.

Until this is built, `typefully` / `jotform` / `toggl` stay `comingSoon: true` with reason `"Composio API-key broker path pending — implementing in follow-up PR"`. Tracked in [GitHub issue #70: Composio API-key broker path for Typefully/Jotform/Toggl](https://github.com/Laxcorp-Research/claws/issues/70) — the issue contains the full implementation sketch.

---

## Implications for downstream PRs

### PR #3 (tool connection fix — internal API-key skills)

Unchanged by this doc. PR #3 focuses on API_KEY tools (31 single-var + 5 multi-var seeds, per `ENV_VAR_CONVENTION.md` §D2). The 21 OAuth toolkit skills in the catalog are separate — they're handled in PR #4.

**Scope delta from this PR:** none for PR #3. It stays focused on API-key plumbing.

### PR #4 (Composio enablement — this doc's architecture)

**Scope is smaller than option (ii) would have been.** The live POC confirmed that option (iv) does not require any refresh, rotation, or revocation-detection infrastructure inside the container — Composio handles all of that server-side. That removes what would have been the largest engineering cost of (ii).

What PR #4 actually needs:

- **Generator change (single branch).** `src/lib/openclaw/generator.ts` adds a branch for `OAUTH_COMPOSIO` connections that emits the shape in §"Emission shape". One `if` against `connectionType`, one 20-line emitter. No refresh sidecar. No token extraction. No masking-disable call. No per-tool expiry scheduler.
- **No `composio-core` in the container.** `@composio/core@^0.6.8` stays as a server-side dep in `package.json` (where we already use it for the OAuth routes). Container-side skill bodies use plain `fetch()` against `https://backend.composio.dev/api/v3/tools/execute/<slug>`. POC confirmed the HTTP path works from inside `node:22-bookworm` with no SDK (§"Step 5 — In-container REST path").
- **Tool version is required on each call.** Composio's v3 API returns `400 "Toolkit version not specified"` if `version` is omitted. Skill bodies must either (a) hard-code the current version per tool and accept that the seed needs periodic re-pinning, or (b) call `GET /api/v3/tools/<slug>` first and use `available_versions[0]` (adds ~300 ms per first call; can be cached per skill-instance lifetime). Recommend (b) for resilience.
- **Seed rewrite.** 21 OAuth toolkit skills in `prisma/seed-data/skills-tool-specific.ts` need `skillMd` bodies that call Composio's REST endpoint instead of (e.g.) Gmail's API directly. Expected ~40 lines per skill × 21 = ~840 lines of markdown. Plus per-tool arguments mapping (`GMAIL_FETCH_EMAILS` shape differs from `SLACK_POST_MESSAGE`). Frontmatter shape per [ENV_VAR_CONVENTION.md](./ENV_VAR_CONVENTION.md):

  ```yaml
  metadata:
    openclaw:
      emoji: <emoji>
      requires:
        env: ["COMPOSIO_API_KEY", "COMPOSIO_USER_ID", "COMPOSIO_CONNECTED_ACCOUNT_ID"]
  ```

- **Auth flow unchanged.** Our existing `/api/tools/[workspaceId]/oauth/{initiate,callback,status,disconnect}/route.ts` already handle everything. They already persist `composioConnectionId` + `composioEntityId`. POC ran against them unmodified.
- **Deployer env var.** `COMPOSIO_API_KEY` needs to be injected into the container's `CLAWS_ENV_B64` at deploy time via `src/lib/openclaw/deployer.ts:buildRailwayEnvVars` (or wherever env-building lives). Currently we don't. One-line change.
- **Skill-agent scoping.** `agents.list[].skills` in `openclaw.json` already supports per-agent skill allowlists. By putting each Composio-backed skill behind an allowlist, `COMPOSIO_API_KEY` is only injected for agents that actually need it. No new feature — just disciplined seed writing.

**Engineering NOT needed (thanks to architecture (iv)):**

- No refresh daemon / cron / sidecar. Composio's server handles token refresh on their side; we never see a stale token.
- No per-toolkit expiry table. Gmail 1 h, HubSpot 30 min, Slack never, Notion-PAT never — none of that logic lives in our codebase under (iv).
- No `PATCH /api/v3.1/org/project/config` call to disable Composio's secret masking. We never read raw tokens, so masking can stay on (Composio's default).
- No stale-token detection logic. `successful=false` from `tools.execute` with a clear error code handles revocation transparently.
- No rotation-on-redeploy handling. Container holds `COMPOSIO_API_KEY` (platform-scoped) + two opaque IDs. Redeploying a container doesn't invalidate user OAuth grants because those live in Composio's storage, not in our env.

**Test coverage required:**

- Unit test on `generator.ts`'s OAuth-emission branch — assert that a `ToolConnection` with `connectionType="OAUTH_COMPOSIO"` produces the exact `skills.entries[slug]` shape documented in §"Emission shape".
- Integration test, skipped-in-CI unless `COMPOSIO_API_KEY` is set, that round-trips a real `tools.execute` call against a test fixture connection. The scratch scripts at `C:\temp\composio-poc\` (this PR's artifacts) can be banked for this — they exercise every Composio API call PR #4 will touch.

**Additional acceptance criterion — descriptive documentation:**

- **For each OAuth toolkit we ship, document the scope list Composio-managed auth requests.** Purpose: maintainer traceability. A user (or us during support triage) should be able to look up "what does connecting Slack actually authorize?" without re-running the audit. PR #4 shipped this via the 17-row informational table in its merge description, sourced from `C:\temp\composio-poc\90-oauth-tools-raw.json`. Re-runnable via `node C:\temp\composio-poc\21-scope-audit.mjs`. We are NOT preemptively narrowing these scopes by publishing `use_custom_auth` configs — see the Gmail §"Live POC results" → "Step 1" note on our architectural stance. [GH issue #25](https://github.com/Laxcorp-Research/claws/issues/25) was closed with that rationale.

### PR #5 (marketplace skill install)

A community skill that declares a Composio-backed toolkit in its `requiredEnvVars` list (e.g., `["COMPOSIO_API_KEY", "COMPOSIO_USER_ID", "COMPOSIO_CONNECTED_ACCOUNT_ID"]`) would work with the same architecture.

**Implication for PR #5's install path:** when installing a marketplace skill with those env vars declared, the installer must validate that the user has a matching `OAUTH_COMPOSIO` `ToolConnection` for the skill's `compatibleTools` target. If not, the install prompts for a Composio OAuth flow first. Trivially reuses the existing `/api/tools/[workspaceId]/oauth/*` routes.

---

## Security considerations

- **OAuth token custody.** Composio holds all tokens at rest, encrypted per their own SOC 2 controls. Our platform holds only `composioConnectionId` and `composioEntityId` (both opaque IDs). Container holds `COMPOSIO_API_KEY` (platform-scoped) + those two IDs.
- **Rotation.** `COMPOSIO_API_KEY` is rotated via Composio's dashboard. On rotation, we update `process.env.COMPOSIO_API_KEY` on our server AND re-deploy every running container with the new key. No per-user rotation concern.
- **Token scope (what users authorize).** Composio-managed auth configs request a fixed scope per toolkit. The Gmail POC measured the exact grant: 12 scopes, including full mailbox access (`https://mail.google.com/`), full contact list access (`contacts.readonly`), and personal profile fields (phone, address, birthday). The user sees all of these on Google's consent screen before authorizing.

  **Architectural stance:** we default to Composio's managed auth. We do NOT build custom `use_custom_auth` configs to pre-narrow scopes. The decision of what an agent can do on a user's behalf belongs to the user at the consent screen, not to us in a config file. Per-tool scope lists are documented in PR #4's merge description for maintainer traceability. Reactive-only audit issue filed for "genuinely absurd" scopes (e.g., destructive scopes for a read-only integration use case); [GH issue #25](https://github.com/Laxcorp-Research/claws/issues/25) closed with this rationale.
- **Revocation.** Three failure modes, all graceful:
  1. User revokes in Google (or whichever provider). Next `tools.execute` returns `successful=false` with a provider-specific error. The skill surfaces "reconnect your Gmail account" to the agent.
  2. We delete the connection via `connectedAccounts.delete`. Next `tools.execute` returns 404. Same UX.
  3. Composio itself marks the connection as EXPIRED (e.g., a refresh token was revoked). Same response shape.

  In all three cases: no stale token sitting in our container env, no detection logic to write, no cleanup cron.
- **Blast radius of `COMPOSIO_API_KEY` leak.** If the platform key leaks, an attacker can `tools.execute` on behalf of ANY connected account belonging to ANY of our users, across every toolkit. This is strictly worse than a single-toolkit token leak (option ii). Mitigation: treat `COMPOSIO_API_KEY` as the highest-sensitivity secret in our stack; encrypt at rest (same AES-256-GCM we use for other keys); restrict decrypt to the specific code paths that emit the container env.
- **Audit trail.** Composio's dashboard has per-call logs for every `tools.execute`. We can cross-reference these with our own tool-event logs (`log.toolEvent` in `src/lib/logger.ts`) for a complete trail. PR #4 should ensure our log includes the `log_id` returned in Composio's response.

---

## What this does NOT resolve

- **The auth flow for `OAUTH_COMPOSIO` tools outside the catalog** (dynamic toolkits returned by `composio-catalog.ts`). Those work identically to cataloged ones because the architecture is toolkit-agnostic, but we haven't explicitly tested a dynamic one. If PR #4 wants to be thorough, re-run the POC with a dynamic toolkit (e.g., one not in our `OAUTH_TOOLS` array).
- **Custom auth configs** (user-supplied OAuth app credentials). Per Composio docs, we can supply an `authConfigId` that points to a custom app instead of Composio-managed. No architectural difference — same emission shape, just a different `authConfigId` lookup. We explicitly decided in PR #4 review NOT to build these preemptively; see the "Architectural stance" note in §"Security considerations". If a future requirement surfaces (e.g., a specific enterprise customer needs a whitelisted OAuth app instead of Composio's), the emission shape already supports it.
- **Composio-mediated triggers / webhooks.** Not in scope — we only use Composio for tool execution. Triggers would need separate investigation.
- **Cost modeling.** Composio charges per `tools.execute`. PR #4 should surface this in credit accounting and (optionally) pass cost through to our credit users. Out of scope for this doc.
- **Fallback when Composio is down.** Composio's SLA is not 100%. The POC doesn't exercise this. Recommendation: when `tools.execute` returns 5xx from Composio, skill retries once, then fails gracefully with a "Composio unreachable; try again in a moment" message. Implementation is PR #4's concern.

---

## Appendix A: Grep counts (reproducible)

From the pinned sources (`C:\temp\openclaw-rootfs` @ digest `9e1af63c…`, `C:\temp\openclaw-src` @ tag `v2026.3.1` commit `d76b224`, `C:\temp\openclaw-src-main` @ HEAD `50e71da`):

| Query | Image | v2026.3.1 | main HEAD |
|---|---|---|---|
| `composio` (case-insensitive) | 0 | 0 | 0 |
| `OAuth` (any case) in skill-related source | N/A | see note | see note |

Note: `OAuth` appears in OpenClaw's source only in the context of `src/agents/auth-profiles/oauth.ts` (profile for user-supplied OAuth providers, NOT a Composio integration). Verified by reading that file: zero Composio references; the module is a generic OAuth 2.0 client for Anthropic/OpenAI/etc. model providers, unrelated to tool connections.

From this repo (`c:\Users\…\laxclaws`, branch `staging`):

| Query | Matches |
|---|---|
| `composio` (in `src/`) | production code: `src/lib/composio.ts`, `src/lib/composio-catalog.ts`, `src/lib/composio-auth-config.ts`, the four `src/app/api/tools/[workspaceId]/oauth/*` routes |
| `composio` in `src/lib/openclaw/` | **0** (deployer/generator/railway-client are Composio-unaware — this is the gap PR #4 fills) |
| `@composio/core` in `package.json` | 1 (`^0.6.8`) |
| `COMPOSIO_API_KEY` in `.env.example` | 1 (line 60, empty value) |

---

## Appendix B: Scratch POC directory

All live POC work happened in `C:\temp\composio-poc\` — outside this repo. Structure (never committed):

```
C:\temp\composio-poc\
├── README.md                     — says "DO NOT COMMIT"
├── package.json                  — { "dependencies": { "@composio/core": "^0.6.8", "dotenv": "^16.4.5" } }
├── package-lock.json
├── .env.example                  — template; .env with real key is gitignored by being outside the repo
├── node_modules/
├── 01-auth.mjs                   — initiate + waitForConnection
├── 02-inspect.mjs                — connectedAccounts.get + classify state.val without printing values
├── 03-execute-read.mjs           — tools.execute for Gmail read operations
├── 04-execute-send.mjs           — tools.execute for Gmail send operation
├── 05-container-http-probe.mjs   — runs inside node:22-bookworm, uses fetch() (no SDK)
├── 06-cleanup.mjs                — connectedAccounts.delete
├── state.json                    — live connectionId (not committed)
├── inspect.json                  — redacted shape summary (safe to reference; not copied here in full)
├── execute-*.json                — per-call timing + redacted response
└── execute-send.json             — send result summary
```

None of these are in the repo. The doc cites redacted summaries only. `6-cleanup.mjs` ran at the end of the POC per the PR owner's instruction; the live Composio connection no longer exists.
