# Container Env Reconciliation Contract (PR-8)

**Status:** DRAFT - Phase 1 (contract spec, pre-implementation). No code in this PR.
**Rollout:** PR-8a (detection cron, DETECT-ONLY; merged `da128a7`) → manual E1–E4 validation on staging (curl-triggered - the staging cron does not auto-fire; see §11) → PR-8b (event triggers; ship DETECT-ONLY on prod, observe 24h real traffic, then flip AUTO-HEAL).
**Related:** PR-7 (UI hardening for the same no-account states), PR-9 (billing-model overhaul - changes exhaustion behavior; see §8).

---

## 0. Problem statement (why this exists)

A container's credential env - `ANTHROPIC_API_KEY`, `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL` - is **baked at deploy time** and **applied once at boot**. Evidence:
- Deploy stamps env from current DB state: `deployer.ts:229-231` (deploy) and `deployer.ts:435-440` (`redeployWorkspace`), both via `buildRailwayEnvVars({ creditMode: apiKeySource === 'PLATFORM_CREDIT' })`.
- The container applies the baked `.env`/Railway vars at boot only - `container/process-manager.mjs` starts the credit-proxy solely on `CLAWS_CREDIT_MODE==='true'` (`:3,:14`) and has **no periodic secret re-fetch** (`setInterval` is `syncState` only, `:328`). `/api/internal/container-secrets` exists but is on-demand, not polled.

Therefore **DB credential mutations do not propagate to running containers.** Confirmed live: WIRE-TEST (`apiKeySource=NONE`, no `CreditAccount`) runs heartbeats on a key baked at an earlier deploy (PR-8 investigation, 2026-06-01). The drift is also **self-documented** in code:

```34:43:src/app/api/api-keys/switch-source/route.ts
  // TODO: Queue container recycle via DO agent
  for (const ws of running) {
    log.info("Container recycle needed", { workspaceId: ws.id, reason: "API_KEY_SOURCE_CHANGED" })
  }
  return apiSuccess({
    switched: true,
    recyclingCount: running.length,
    message: "Your agents will restart with your own API key. This takes about 30 seconds.",
  })
```

The endpoint **logs a TODO and tells the user agents will restart in ~30s - but nothing recycles.** That user-facing message is currently false (PR-4-truthfulness-adjacent).

---

## 1. Trigger events (audit-grounded)

| # | Event | Mutation site | DB change | Container-relevant? |
|---|---|---|---|---|
| E1 | Add / update BYOK key | `POST /api/api-keys` (`api-keys/route.ts:38-51`) | `userApiKey.create`/`update` (`encryptedKey`, `isValid`) | **Yes** - a `USER_OWN_KEY`/`NONE` container should use the new key |
| E2 | Remove BYOK key | `DELETE /api/api-keys/[id]` (`api-keys/[id]/route.ts:14`) | `userApiKey.delete` | **Yes** - container should lose the key |
| E3 | Switch credit → BYOK | `POST /api/api-keys/switch-source` (`switch-source/route.ts:20-37`) | `user.apiKeySource → USER_OWN_KEY`; `creditAccount → CONVERTED` | **Yes** - drop master key + proxy, use user key. **(the TODO above)** |
| E4 | Credit grant | `lib/credits/grant.ts:49,65` | `creditAccount.create`; `user.apiKeySource → PLATFORM_CREDIT` | **Conditionally** - only if a RUNNING container already exists (grant is normally pre-deploy) |
| E5 | Credit exhaustion | `report-batch` → `onCreditsExhausted` (`exhaustion.ts:14-39`) | `creditAccount.status → EXHAUSTED`; **destroys container** (PLATFORM_CREDIT) | **Already handled** - container destroyed, so no stale key persists (changes under PR-9; see §8) |
| E6 | Key validate / test | `POST /api/api-keys/[id]/validate`, `/api/api-keys/test` | `userApiKey.update(isValid, lastError)` | **No** - `isValid` is a UI flag; neither `container-secrets` nor the generator gate the key *value* on it. **Not a trigger.** |
| E7 | `apiKeySourceOverride` set/clear | **No writer exists today** (grep: only read at `api-key-source.ts:13`; unused field) | - | **Future** - if a writer is ever added, it MUST trigger (see §1.1) |
| E8 | Credit reactivation `EXHAUSTED → ACTIVE` (top-up) | **No path today** (one-time $50 grant; `CONVERTED` on BYOK switch) | - | **Future** - relevant once PR-9 adds top-ups |

**§1.1 - Forward guard:** E7 and E8 are not reachable today but are first-class contract triggers. Any future PR that writes `Workspace.apiKeySourceOverride`, flips `CreditAccount.status → ACTIVE`, or otherwise changes the inputs to `getApiKeySource()` MUST call the reconcile path (and a test must assert it). The cron (§6) is the backstop if a future author forgets.

---

## 2. Effects - current vs contract

| Event | Current behavior | Contract behavior (post-PR-8) |
|---|---|---|
| E1 add/update BYOK | DB write only; running container keeps old/absent key | Reconcile: container env's `ANTHROPIC_API_KEY` = `decrypt(new key)`, `CLAWS_CREDIT_MODE=false`, no `ANTHROPIC_BASE_URL` |
| E2 remove BYOK | DB write only; container keeps the deleted key (drift) | Reconcile: container env's `ANTHROPIC_API_KEY` removed; agent calls correctly fail until a new key/source is set |
| E3 switch → BYOK | **TODO log only**; false "agents will restart" message | Reconcile: drop master key + proxy + `ANTHROPIC_BASE_URL`, set `CLAWS_CREDIT_MODE=false` + user key; the success message becomes true |
| E4 grant (running container) | DB write only; container stays non-credit (no proxy/metering) | Reconcile: `CLAWS_CREDIT_MODE=true`, master key, `ANTHROPIC_BASE_URL=localhost:3789` |
| E5 exhaustion | Container destroyed + hibernated (`exhaustion.ts:17,35`) | Unchanged in PR-8 (already acts on the container); revisit in PR-9 |
| E6 validate/test | DB flag update; no container effect | Unchanged - explicitly NOT a trigger |
| E7 / E8 | n/a (no writer) | Reconcile when a writer lands (§1.1) |

**Effect mechanism already exists** and is reused verbatim - `redeployWorkspace()` re-derives env from *current* DB and re-applies it:

```425:447:src/lib/openclaw/deployer.ts
export async function redeployWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (isRailwayConfigured() && workspace.containerId && workspace.status === 'RUNNING') {
    const redeployUser = await prisma.user.findUniqueOrThrow({ where: { id: workspace.userId } });
    const generated = await generateWorkspace(workspaceId);
    const redeploySource = getApiKeySource(workspace, redeployUser);
    const envVars = buildRailwayEnvVars(generated, workspace, {
      creditMode: redeploySource === 'PLATFORM_CREDIT', workspaceId, userId: workspace.userId,
    });
    await updateServiceVariables(workspace.containerId, envVars);
    await redeployService(workspace.containerId);
    return;
  }
  await deployToCloud(workspaceId);
}
```
PR-8 does **not** invent a new effect - it adds *triggering* + *idempotency/skip* + a *detection cron* around this existing function.

---

## 3. Invariants (testable assertions)

After any reconciliation (event- or cron-driven) completes for a `RUNNING` container, all must hold:

- **I1 - Key correctness.** Live `ANTHROPIC_API_KEY` equals the value the current DB would derive *right now*: `PLATFORM_CREDIT` → platform master key; `USER_OWN_KEY`/`NONE` with an `ANTHROPIC` `UserApiKey` → `decrypt(encryptedKey)`; `NONE` with no key → **absent**.
- **I2 - Credit-mode correctness.** Live `CLAWS_CREDIT_MODE === String(getApiKeySource(...) === 'PLATFORM_CREDIT')`.
- **I3 - Base-URL correctness.** Live `ANTHROPIC_BASE_URL` is `http://localhost:3789` iff credit mode, else absent.
- **I4 - No mid-call failure beyond a normal redeploy.** Reconciliation is no more disruptive than a user-initiated redeploy; it relies on the runtime's SIGTERM state-sync (`process-manager.mjs syncState`) for continuity. It MUST NOT half-apply env (see I6).
- **I5 - Idempotency.** `reconcile(ws)` on an already-correct container performs **zero** Railway writes and **zero** restarts. Test: expected==actual ⇒ no `updateServiceVariables`/`redeployService` call.
- **I6 - Atomicity (no half-state).** Variables are written as one complete set (`updateServiceVariables(containerId, envVars)`) *before* a single `redeployService`. A run never updates a subset or restarts before the full var set is applied. On any failure before the restart, the container is left on its prior (consistent) deployment.

---

## 4. Failure modes & policy

| Failure | Policy |
|---|---|
| **Railway API error** (read or write) during reconcile | Retry ≤3 with exponential backoff (1s/4s/16s). Persistent failure → `log.error` + Axiom alert; **leave container untouched** (never partial-apply). In DETECT-ONLY, just log the read failure. |
| **Container not `RUNNING`** (DEPLOYING/WAKING/HIBERNATED/STOPPED) | **Skip** this tick - only `status==='RUNNING' && containerId` is eligible (mirrors `redeployWorkspace`'s own guard). Re-evaluated next cron tick / next event. Never reconcile mid-deploy. |
| **DB read fails** for a workspace | Abort *that* workspace, `log.error`, do **not** touch its container; continue others. |
| **Redeploy loop risk** | I5 idempotency (skip when expected==actual) + a per-workspace cooldown (the `reconcile:cooldown:${workspaceId}` NX key, TTL `RECONCILE_COOLDOWN_SEC`, default 1800s = 30m) + a per-run cap (`RECONCILE_MAX_PER_RUN`, default 20) to bound Railway load and blast radius. |
| **Concurrent events / cron, same container** | Safe by design: reconcile **re-derives from current DB**, not from an event payload - last writer applies current truth. The **same** `reconcile:cooldown:${workspaceId}` key is the concurrency guard: `healWorkspace` does `SET NX` *before* the redeploy, so whichever path (cron tick or event fast-path) acquires it first heals and any concurrent attempt skips (`cooldown_active`); on heal failure the key is `DEL`'d so a failed heal retries next tick instead of being locked out for the full window. **Design note:** an NX key with a TTL serves both purposes - *acquisition* prevents concurrent heals, *expiration* enforces the cooldown - so two separate keys (a short dedup lock + a long cooldown) would be redundant. Mirrors §6's `Mode flag` description (single source of truth). |

---

## 5. Mechanism - recommendation

**Recommended: A2-cron backbone + A1 best-effort event fast-path (an "A3-lite" with the cron as the durable retry layer instead of a new queue table).**

- **Event endpoints (E1–E4, future E7/E8)** call an idempotent, **fire-and-forget** `requestReconcile(workspaceId)` (does not block the HTTP response; failures are swallowed *by design* because the cron backstops). Gives users the fast "agents restarted" outcome they're promised.
- **Cron (§6)** is the source of truth and safety net: it re-derives expected env, detects drift, and (in AUTO-HEAL) reconciles anything the event path missed or that failed.

**Why not the others:**
- **A1 alone** swallows redeploy errors with no retry → silent drift on transient Railway failures. Rejected as the *sole* mechanism.
- **A2 alone** has a multi-minute drift window after every credential change → the `switch-source` UX ("~30 seconds") stays false. Rejected as the *sole* mechanism.
- **A3 with a new `pending_reconciliations` table/queue** adds schema + a worker for a guarantee the **idempotent cron already provides**. Rejected for scope; the cron *is* the durable retry layer. (If event volume ever needs backpressure, A3's table can be added later without changing the contract.)

This reuses the existing cron pattern (`reconcile-credit-balances`) and `redeployWorkspace()` - minimal new surface, with the cron's idempotency (I5) guaranteeing the event fast-path and the cron can never conflict or loop.

---

## 6. Reconciliation cron spec (the safety net)

- **Route:** `GET /api/cron/reconcile-container-env`. **Auth:** `Bearer ${CRON_SECRET}` (verbatim from `reconcile-credit-balances/route.ts:9-12`). `export const maxDuration = 55`.
- **Schedule (milestone progression):**
  - DETECT-ONLY: `*/15 * * * *` (bounds Railway API load during the observation window).
  - AUTO-HEAL initial: `*/15` stays for the first 24h after the flip (prove healing is safe at the slow cadence first).
  - AUTO-HEAL stable: tighten to `*/5 * * * *` after 24h of clean AUTO-HEAL, matching `reconcile-credit-balances` cadence - shipped as **PR-8c** (a `vercel.json` schedule + cap + log-threshold change; no logic change). Rationale: the cron is the backstop, and the per-event fast-path (§5, PR-8b) is what actually delivers the `switch-source` "~30 seconds" promise - but the backstop cadence still needs to be tighter than `*/15` once healing is trusted. Added to `vercel.json crons[]`.
  - **LIVE - `*/5` is the current production cadence as of PR-8c (2026-06-09)**, after 40h+ of clean AUTO-HEAL at `*/15`. PR-8c also reduced `RECONCILE_MAX_PER_RUN` 20 → **10** so the worst-case tick (read timeouts ~10s × cap + heal triggers ~2-3s × cap) stays comfortably under `maxDuration = 55s`; net throughput rises (`*/5` × 10 = 120 ws/hr vs `*/15` × 20 = 80 ws/hr).
- **Scope query:** `workspace.findMany({ where: { status: 'RUNNING', containerId: { not: null } } })` with `user { apiKeys, creditAccount }`.
- **Expected env:** re-derive via `getApiKeySource()` + the env-builder (a pure helper extracted from `buildRailwayEnvVars`/generator in Phase 2). Compare only the **credential-relevant** subset: `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`.
  - **Deliberately outside this surface: `OPENCLAW_GATEWAY_TOKEN`.** It is emitted at deploy time (three paths - Railway var, `CLAWS_ENV_B64`, container-secrets) but never drift-compared; if the Railway value diverges from `Workspace.gatewayToken`, nothing detects it until an authed call fails. Load-bearing for dashboard chat since PR-9/A (`docs/OPENCLAW_GATEWAY_PROTOCOL.md` §8 risk 1 - the chat client logs `gateway token mismatch` loudly when it hits this). Adding it to the surface is future scope; this note exists so the omission is a decision, not an accident.
  - Credit users: `ANTHROPIC_API_KEY` is a plain Railway var (master key) → compare directly.
  - BYOK/NONE: the key lives inside `CLAWS_ENV_B64` (base64 `.env`) → decode + parse, then compare a **non-secret fingerprint** (`sha256(value)` or the stored `keyHint`).
  - **Design note - fingerprint detects *change*, not *value*:** the fingerprint proves a BYOK key drifted from DB without revealing what it changed to, and that is sufficient. The cron's job is detect-and-correct, not diagnose; the heal action is always "redeploy with the current DB-derived value" regardless of what the drifted value was. Do **not** add diagnostic detail that would require logging raw key material. The helper types it **`keyFingerprint: string | null`** (always present; `null` when no key - *not* optional), so the comparison reads it uniformly.
- **Actual env source:** Railway variables API. Requires a **read** helper `getServiceVariables(containerId)` on the Railway client (write-side `updateServiceVariables` exists; the read is a Phase-2 add). Fallback option (if Railway read is unreliable): a container plugin "report current env fingerprint" endpoint - deferred unless needed.
- **Drift evaluation - transient-window exclusions (a delta is NOT counted as `drift_detected` unless ALL hold):**
  - (a) Workspace `status === 'RUNNING'` at comparison time (already required by the §4 scope guard).
  - (b) **≥60s elapsed since the workspace's latest `Deployment.completedAt`** (`RECONCILE_GRACE_MS`; strict less-than - **exactly 60s proceeds**) - guards against reading a mid-redeploy window where Railway vars are applied but the container hasn't fully cut over (partial-update false positive). Also skips when there is **no** latest `Deployment` row (`no_deployment_record`) or its `completedAt` is `null` (`deploy_in_progress`).
  - (c) Workspace `status` is still `RUNNING` on a **second DB read** taken AFTER the Railway call (the "after" snapshot vs the scope-query "before"). If it changed (`status_changed_midwindow`) or the row was **deleted** between the two reads (`workspace_deleted_midwindow`), discard the comparison and re-evaluate next tick. This single after-read subsumes the audit's old `not_running_at_compare` check.
  A delta that fails (a)/(b)/(c) is logged at `info` as `event: "drift_skipped_transient"` (so suppression rates are observable), **never** as `drift_detected`.
- **Mode flag:** `ENV_RECONCILE_MODE = "detect_only" | "auto_heal"` (default `detect_only`). In `auto_heal`, after logging drift, call `redeployWorkspace(workspaceId)` subject to §4 cooldown/cap/lock. **PR-8b/B - implemented and real:** the PR-8a/C in-route downgrade (auto_heal→detect_only + warning) is removed. A shared `resolveMode` (`@/lib/openclaw/reconcile-mode`) and a shared `healWorkspace` core (`@/lib/openclaw/heal-workspace`, also used by the event fast-path) gate the heal behind a per-workspace Redis cooldown `reconcile:cooldown:${workspaceId}` (NX, TTL `RECONCILE_COOLDOWN_SEC`, default 1800s = 30m; acquired *before* the redeploy, released on failure so a failed heal retries next tick). The `run_complete` summary gains `healed`, `skipped.cooldown_active`, and `errors.heal_error` (additive - Axiom monitors filter on `category`+`event`, so this is backward-compatible). **The `ENV_RECONCILE_MODE=auto_heal` flag-flip on the prod Vercel env is the moment AUTO-HEAL goes live** - the PR-8b code ships dormant under the default `detect_only` (the same gate covers the event fast-path, so the flip turns healing on everywhere at once).
- **Log shape (for the Axiom dashboard alert) - never log raw secrets:**
  - Per drift: `log.warn("container env drift detected", { category: "env_reconciliation", event: "drift_detected", workspaceId, userId, field: "credit_mode" | "anthropic_key" | "base_url", expected: <bool|hint|hash>, actual: <bool|hint|hash>, mode })`
  - Per heal (auto_heal): `log.info("container env reconciled", { category: "env_reconciliation", event: "healed", workspaceId, mode })`
  - Per error: `log.error("container env reconcile failed", { category: "env_reconciliation", event: "error", workspaceId, error, mode })`
  - Per transient skip: `log.info("env reconciliation skipped (transient)", { category: "env_reconciliation", event: "drift_skipped_transient", workspaceId, reason, ...extra })` where `reason ∈ { "recent_deploy", "deploy_in_progress", "status_changed_midwindow", "no_deployment_record", "workspace_deleted_midwindow", "tick_capped" }`. Useful `extra`: `recent_deploy` → `msAgo`; `deploy_in_progress` → `deploymentStatus`; `status_changed_midwindow` → `statusBefore`+`statusAfter`. (Dropped the audit's `not_running_at_compare` - the after-read's `status_changed_midwindow` subsumes it.)
  - Run summary: `log.info("env reconciliation complete", { category: "env_reconciliation", event: "run_complete", checked, drifts, healed, errors, skipped, mode })`
  - **Alert:** Axiom monitor on `category="env_reconciliation" AND event="drift_detected"` (rate) and `event="error"`.
- **Security:** the cron only ever logs booleans / hints / hashes. Raw key material never leaves `decrypt()`/comparison scope.

---

## 7. Rollout plan

- **PR-8a - detection only:** this contract doc + the cron in **DETECT-ONLY** mode (`*/15`) + Railway `getServiceVariables` read helper + the env-fingerprint comparison + the transient-window exclusions (§6). **Deployed and live (PR-8a/C, merged `da128a7`).**
  - **Observation-window revision - see §11.** Vercel runs `vercel.json` crons on **Production deployments only**; the staging cron never auto-fires, and prod has **zero in-scope workspaces** (no customers). The original passive 48–72h staging watch is therefore replaced by **active, curl-triggered validation on staging** plus **deferred real observation in PR-8b's prod deploy**.
  - **Exit criteria to unlock PR-8b *implementation* (ALL required):**
    1. **E1–E4 manually exercised on staging** against the reprovisioned WIRE-TEST workspace by driving DB state changes and **triggering the cron via curl** (`GET …/api/cron/reconcile-container-env`, `Authorization: Bearer ${CRON_SECRET}`). Record, for each case, the DB state change made and the actual cron response - a `drift_detected` with its `driftFields` (∈ {`credit_mode`, `base_url`, `key_fp`}) or a clean `run_complete`.
    2. For each detected drift, **confirm it matches what AUTO-HEAL would heal** (`redeployWorkspace` would produce the expected DB-derived env).
    3. **Green test + mutation coverage** on the cron logic (unit + integration + mutation sweep).
  - **Exit met = E1–E4 curl-triggered exercises recorded + drift-matches-heal confirmed + green test/mutation coverage.** This unlocks PR-8b *implementation*; **real observation is deferred to PR-8b's prod deploy (next bullet).** Record the exercise log links in the PR-8b description.
- **PR-8b - the fix:** event-triggered `requestReconcile()` wired into E1–E4 (+ the `switch-source` message becomes truthful) + cooldown/cap/lock. **Ships in DETECT-ONLY on prod** (not AUTO-HEAL at merge): because staging cannot provide a real observation window (§11), the genuine signal is the flip moment under real traffic - **monitor prod for 24h with real customer traffic (or the first real workspace) in DETECT-ONLY, then flip `ENV_RECONCILE_MODE → auto_heal` only after that 24h is clean** (stays at `*/15` for the first 24h of AUTO-HEAL). **Pre-merge: complete the §7.5 staging log check.** Contract tests assert I1–I6 and the §4 policies; a regression test asserts `switch-source` actually triggers reconcile (locks in the TODO fix).
- **PR-8c - cadence tighten (SHIPPED 2026-06-09):** after **40h+ of clean AUTO-HEAL at `*/15`**, tightened the cron to `*/5` (`vercel.json` schedule) and reduced `RECONCILE_MAX_PER_RUN` 20 → 10 to bound the worst-case tick under `maxDuration = 55s`. Small standalone PR, **no logic change**. Rationale: the `switch-source` UX promise needs a backstop faster than `*/15` once healing is trusted. **Completes the PR-8 family** - the platform credential drift safety net (detect → heal → cadence) is in place.

## 7.5. Pre-PR-8b staging log check (a pre-merge gate for PR-8b, not a separate PR)

Before PR-8b merges, query staging Axiom for historical `"Container recycle needed"` entries (emitted by `switch-source/route.ts:35`, `reason: "API_KEY_SOURCE_CHANGED"`). **Each entry is a real user who hit the E3 lie** - told "agents will restart in ~30s" while nothing recycled - and is therefore running on **stale env**.
- If any exist: **manually reconcile those workspaces** (redeploy with current DB state) *before* PR-8b's auto-fix lands, so (a) those users stop running on a stale key sooner and (b) AUTO-HEAL doesn't first encounter them as a surprise batch of drifts on flip day.
- Record the affected `workspaceId`s and confirm each is reconciled. This is a checklist item in the PR-8b description, gated before merge.

---

## 8. Out of scope (tracked elsewhere)

- **E5 exhaustion behavior** changes under **PR-9** (per-Claw subscription model: exhaustion no longer destroys containers - see the `exhaustion.ts:26-34` TODO). PR-8 leaves E5 as-is.
- **`isValid` flag** flips (E6) - deliberately not a trigger.
- **Subscription eligibility** (`hasActiveSubscription`) - affects deploy gating, not the API-key value; out of scope for key reconciliation.
- **WIRE-TEST cleanup** - operational (reprovision as a proper credit user once 3a/3b is confirmed), not code.

---

## 9. Testable-assertion index (for Phase 2)

| ID | Assertion | Source |
|---|---|---|
| A-I1..I3 | Post-reconcile env matches DB-derived key / credit-mode / base-url | §3 |
| A-I5 | Correct container ⇒ no Railway write, no restart | §3 |
| A-I6 | Full var set applied before single restart; no subset writes | §3 |
| A-E3 | `switch-source` triggers `requestReconcile` (TODO regression lock) | §1/§2 |
| A-F-railway | Railway error ⇒ retry≤3, then leave-untouched + error log | §4 |
| A-F-nonrunning | non-`RUNNING` workspace ⇒ skipped | §4 |
| A-F-cooldown | same workspace not reconciled twice within cooldown | §4 |
| A-cron-detect | DETECT-ONLY logs drift, performs **no** redeploy | §6 |
| A-cron-heal | AUTO-HEAL logs drift **and** calls `redeployWorkspace` (cooldown-gated) - **implemented PR-8b/B** | §6 |
| A-cron-cooldown | AUTO-HEAL skips a workspace whose `reconcile:cooldown` is held (`skipped.cooldown_active`); a failed heal releases the cooldown so a later tick retries - **PR-8b/B** | §4/§6 |
| A-log-shape | drift/heal/error/summary/transient-skip logs carry the fixed `category`+fields; no raw secrets | §6 |
| A-fingerprint | BYOK key comparison uses a value fingerprint (sha256/keyHint), not raw/encrypted-blob equality | §6 |
| A-grace | a delta within 60s of `Deployment.completedAt`, or with a status change mid-window, is suppressed as `drift_skipped_transient` (not `drift_detected`) | §6/§7 |

---

## 9b. Placeholder env guard + credit-proxy observability backlog (−9)

**Placeholder guard (shipped):** `deriveContainerEnv` and `buildRailwayEnvVars` refuse any string value matching `/^placeholder-/` (loud throw). Prevents local `.env.local` stubs such as `METERING_MASTER_SECRET=placeholder-generate-random-hex` from being baked into Railway as `CLAWS_METERING_SECRET` (WAKE-4: proxy looks healthy, reserve/report-batch 401 forever, zero `CreditUsageRecord`).

**−9 observability (queued, not in this PR):** the in-container credit proxy still lacks operator-visible report/spawn signals. Spec for the next overlay/image bump:

1. Log on report success: `[credit-proxy] report-batch ok n=…`
2. Log on report failure: `[credit-proxy] report-batch failed status=… / error=…` (today failures silent-requeue with no log)
3. On SIGTERM flush: log flushed pending count (shutdown already calls `flush()`)
4. Emit an `ActivityLog` spawn-status event when the proxy starts / becomes healthy / fails health

Until −9 lands, ATTEMPT-5-class forks (real `apiCost` + zero `CreditUsageRecord` with a healthy Listening line) cannot be distinguished in Railway logs between **proxy bypass** and **silent report requeue**.

---

## 10. Non-goals / derivation scope (why `deriveContainerEnv` is Anthropic-only)

`deriveContainerEnv` (`src/lib/openclaw/derive-container-env.ts`) is deliberately scoped to the **credit-mode / Anthropic credential triple** (`ANTHROPIC_API_KEY`, `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL`, plus the drift `keyFingerprint`) because that triple - and only that triple - is what *drifts* between DB state and a running container when a user's `apiKeySource` or keys change. It is the contract surface for this reconciliation effort, not a general-purpose provider-env manager. As of PR-8a it is the single source of truth for the two paths that inject those vars into a live container: the deploy path (`deployer.ts:buildRailwayEnvVars`) and the runtime secret-fetch path (`container-secrets/route.ts`). The remaining emission of `ANTHROPIC_API_KEY` in the codebase - `generator.ts` baking it into the workspace `.env` (`generator.ts:647`) - is **intentionally left separate**: the generator is a multi-provider `.env` baker that provisions *every* configured provider key for the workspace (Anthropic, OpenAI, etc. - see `generator.ts:84`), which is a workspace-provisioning concern unrelated to credit-mode drift. Folding it into `deriveContainerEnv` today would force an Anthropic-only helper to grow multi-provider responsibilities it doesn't need. If multi-provider metering is ever introduced (the platform currently meters only `provider="ANTHROPIC"` in `report-batch`), the expansion path is: extend `deriveContainerEnv` to emit the full provider set, then unify `generator.ts`'s `.env` baking onto it - at which point the "single source of truth" guarantee extends to all providers. Until then, `generator.ts` is the documented, expected exception, and the §9 assertions cover only the Anthropic/credit-mode surface. The other documented exception is `OPENCLAW_GATEWAY_TOKEN` (§6 note): emitted at deploy time, never drift-compared, load-bearing for dashboard chat since PR-9/A.

---

## 11. Staging-cron limitation discovered post-merge (PR-8a/C amendment)

**Discovered:** 2026-06-04, after PR-8a/C (`da128a7`) shipped the DETECT-ONLY cron to both prod and staging.

**Finding - Vercel runs `vercel.json` crons on Production deployments only.** The cron route is *deployed* on staging (reachable, `Bearer`-auth-gated - verified returning 401 unauthenticated), but Vercel's scheduler **never invokes it there**. Confirmed via Axiom: ~2h of `category=env_reconciliation` logs are **100% `environment=production`**, with **zero** preview/staging entries. Prod fires on `*/15` correctly, but it has **zero in-scope workspaces** (`status=RUNNING` + `containerId`), because there are no customers yet - so every prod tick is a clean all-zero `run_complete`.

**Impact on §7's original gate.** The original PR-8a exit window assumed the *staging* cron would, on Vercel's schedule, observe the WIRE-TEST workspace and emit `drift_detected` over a passive 48–72h watch. **That assumption does not hold:** with no staging scheduler tick, nothing fires automatically there, and the only Production subject is an empty scope. A passive observation window, as originally written, cannot run.

**Resolution - gating sequence changed, safety net preserved.**
1. **Staging validation becomes active, not passive.** Drive DB state changes against the reprovisioned WIRE-TEST workspace and **manually trigger the cron via curl** (`GET …/api/cron/reconcile-container-env` with `Authorization: Bearer ${CRON_SECRET}`). Each curl is a single deterministic tick that exercises the detect-and-compare path for one E-case (see revised §7). This proves E1–E4 immediately instead of waiting for a scheduler that never runs.
2. **Real observation moves to PR-8b's prod deploy.** The genuinely informative signal is the **flag-flip moment under real customer traffic**, not a known-broken test fixture. PR-8b ships DETECT-ONLY on prod, observes 24h with real traffic (or the first real workspace), and flips to AUTO-HEAL only after that 24h is clean.

**Why this is sound, not a shortcut.** WIRE-TEST is a *known-broken* fixture producing *known* drift; passively watching it for 72h would add latency without adding confidence beyond the first observed tick. The deterministic curl-triggered exercise proves the comparison path for every E-case at once, and false-positive risk is only meaningful against *real* workspaces - which is exactly what the 24h real-traffic gate in PR-8b covers. **This is a contract amendment, not an abandonment:** the cron, its DETECT-ONLY-first discipline, the §6 transient-window exclusions, and the 24h-clean-before-AUTO-HEAL safety gate are all preserved. Only the *location* and *trigger* of the observation change - staging-passive → staging-manual (curl) + prod-real (PR-8b).

> For the general, forward-facing Vercel-cron operational caveats - this Production-only limitation, schedule-propagation behavior, and the observed PR-8c timings - see **`docs/VERCEL_CRON_NOTES.md`**.
