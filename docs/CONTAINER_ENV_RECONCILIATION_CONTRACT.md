# Container Env Reconciliation Contract (PR-8)

**Status:** DRAFT — Phase 1 (contract spec, pre-implementation). No code in this PR.
**Rollout:** PR-8a (detection cron, DETECT-ONLY) → observe 48–72h → PR-8b (event triggers + cron AUTO-HEAL).
**Related:** PR-7 (UI hardening for the same no-account states), PR-9 (billing-model overhaul — changes exhaustion behavior; see §8).

---

## 0. Problem statement (why this exists)

A container's credential env — `ANTHROPIC_API_KEY`, `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL` — is **baked at deploy time** and **applied once at boot**. Evidence:
- Deploy stamps env from current DB state: `deployer.ts:229-231` (deploy) and `deployer.ts:435-440` (`redeployWorkspace`), both via `buildRailwayEnvVars({ creditMode: apiKeySource === 'PLATFORM_CREDIT' })`.
- The container applies the baked `.env`/Railway vars at boot only — `container/process-manager.mjs` starts the credit-proxy solely on `CLAWS_CREDIT_MODE==='true'` (`:3,:14`) and has **no periodic secret re-fetch** (`setInterval` is `syncState` only, `:328`). `/api/internal/container-secrets` exists but is on-demand, not polled.

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

The endpoint **logs a TODO and tells the user agents will restart in ~30s — but nothing recycles.** That user-facing message is currently false (PR-4-truthfulness-adjacent).

---

## 1. Trigger events (audit-grounded)

| # | Event | Mutation site | DB change | Container-relevant? |
|---|---|---|---|---|
| E1 | Add / update BYOK key | `POST /api/api-keys` (`api-keys/route.ts:38-51`) | `userApiKey.create`/`update` (`encryptedKey`, `isValid`) | **Yes** — a `USER_OWN_KEY`/`NONE` container should use the new key |
| E2 | Remove BYOK key | `DELETE /api/api-keys/[id]` (`api-keys/[id]/route.ts:14`) | `userApiKey.delete` | **Yes** — container should lose the key |
| E3 | Switch credit → BYOK | `POST /api/api-keys/switch-source` (`switch-source/route.ts:20-37`) | `user.apiKeySource → USER_OWN_KEY`; `creditAccount → CONVERTED` | **Yes** — drop master key + proxy, use user key. **(the TODO above)** |
| E4 | Credit grant | `lib/credits/grant.ts:49,65` | `creditAccount.create`; `user.apiKeySource → PLATFORM_CREDIT` | **Conditionally** — only if a RUNNING container already exists (grant is normally pre-deploy) |
| E5 | Credit exhaustion | `report-batch` → `onCreditsExhausted` (`exhaustion.ts:14-39`) | `creditAccount.status → EXHAUSTED`; **destroys container** (PLATFORM_CREDIT) | **Already handled** — container destroyed, so no stale key persists (changes under PR-9; see §8) |
| E6 | Key validate / test | `POST /api/api-keys/[id]/validate`, `/api/api-keys/test` | `userApiKey.update(isValid, lastError)` | **No** — `isValid` is a UI flag; neither `container-secrets` nor the generator gate the key *value* on it. **Not a trigger.** |
| E7 | `apiKeySourceOverride` set/clear | **No writer exists today** (grep: only read at `api-key-source.ts:13`; unused field) | — | **Future** — if a writer is ever added, it MUST trigger (see §1.1) |
| E8 | Credit reactivation `EXHAUSTED → ACTIVE` (top-up) | **No path today** (one-time $25 grant; `CONVERTED` on BYOK switch) | — | **Future** — relevant once PR-9 adds top-ups |

**§1.1 — Forward guard:** E7 and E8 are not reachable today but are first-class contract triggers. Any future PR that writes `Workspace.apiKeySourceOverride`, flips `CreditAccount.status → ACTIVE`, or otherwise changes the inputs to `getApiKeySource()` MUST call the reconcile path (and a test must assert it). The cron (§6) is the backstop if a future author forgets.

---

## 2. Effects — current vs contract

| Event | Current behavior | Contract behavior (post-PR-8) |
|---|---|---|
| E1 add/update BYOK | DB write only; running container keeps old/absent key | Reconcile: container env's `ANTHROPIC_API_KEY` = `decrypt(new key)`, `CLAWS_CREDIT_MODE=false`, no `ANTHROPIC_BASE_URL` |
| E2 remove BYOK | DB write only; container keeps the deleted key (drift) | Reconcile: container env's `ANTHROPIC_API_KEY` removed; agent calls correctly fail until a new key/source is set |
| E3 switch → BYOK | **TODO log only**; false "agents will restart" message | Reconcile: drop master key + proxy + `ANTHROPIC_BASE_URL`, set `CLAWS_CREDIT_MODE=false` + user key; the success message becomes true |
| E4 grant (running container) | DB write only; container stays non-credit (no proxy/metering) | Reconcile: `CLAWS_CREDIT_MODE=true`, master key, `ANTHROPIC_BASE_URL=localhost:3789` |
| E5 exhaustion | Container destroyed + hibernated (`exhaustion.ts:17,35`) | Unchanged in PR-8 (already acts on the container); revisit in PR-9 |
| E6 validate/test | DB flag update; no container effect | Unchanged — explicitly NOT a trigger |
| E7 / E8 | n/a (no writer) | Reconcile when a writer lands (§1.1) |

**Effect mechanism already exists** and is reused verbatim — `redeployWorkspace()` re-derives env from *current* DB and re-applies it:

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
PR-8 does **not** invent a new effect — it adds *triggering* + *idempotency/skip* + a *detection cron* around this existing function.

---

## 3. Invariants (testable assertions)

After any reconciliation (event- or cron-driven) completes for a `RUNNING` container, all must hold:

- **I1 — Key correctness.** Live `ANTHROPIC_API_KEY` equals the value the current DB would derive *right now*: `PLATFORM_CREDIT` → platform master key; `USER_OWN_KEY`/`NONE` with an `ANTHROPIC` `UserApiKey` → `decrypt(encryptedKey)`; `NONE` with no key → **absent**.
- **I2 — Credit-mode correctness.** Live `CLAWS_CREDIT_MODE === String(getApiKeySource(...) === 'PLATFORM_CREDIT')`.
- **I3 — Base-URL correctness.** Live `ANTHROPIC_BASE_URL` is `http://localhost:3789` iff credit mode, else absent.
- **I4 — No mid-call failure beyond a normal redeploy.** Reconciliation is no more disruptive than a user-initiated redeploy; it relies on the runtime's SIGTERM state-sync (`process-manager.mjs syncState`) for continuity. It MUST NOT half-apply env (see I6).
- **I5 — Idempotency.** `reconcile(ws)` on an already-correct container performs **zero** Railway writes and **zero** restarts. Test: expected==actual ⇒ no `updateServiceVariables`/`redeployService` call.
- **I6 — Atomicity (no half-state).** Variables are written as one complete set (`updateServiceVariables(containerId, envVars)`) *before* a single `redeployService`. A run never updates a subset or restarts before the full var set is applied. On any failure before the restart, the container is left on its prior (consistent) deployment.

---

## 4. Failure modes & policy

| Failure | Policy |
|---|---|
| **Railway API error** (read or write) during reconcile | Retry ≤3 with exponential backoff (1s/4s/16s). Persistent failure → `log.error` + Axiom alert; **leave container untouched** (never partial-apply). In DETECT-ONLY, just log the read failure. |
| **Container not `RUNNING`** (DEPLOYING/WAKING/HIBERNATED/STOPPED) | **Skip** this tick — only `status==='RUNNING' && containerId` is eligible (mirrors `redeployWorkspace`'s own guard). Re-evaluated next cron tick / next event. Never reconcile mid-deploy. |
| **DB read fails** for a workspace | Abort *that* workspace, `log.error`, do **not** touch its container; continue others. |
| **Redeploy loop risk** | I5 idempotency (skip when expected==actual) + a per-workspace cooldown (no reconcile of the same `workspaceId` more than once per `RECONCILE_COOLDOWN_MIN`, default 30m) + a per-run cap (`RECONCILE_MAX_PER_RUN`, default 20) to bound Railway load and blast radius. |
| **Concurrent events, same container** | Safe by design: reconcile **re-derives from current DB**, not from an event payload — last writer applies current truth. To avoid two simultaneous redeploys, take a short Redis lock `reconcile:lock:${workspaceId}` (TTL 120s); if held, skip (cron backstops). Last-write-wins is the contract; the lock only prevents redundant concurrent restarts. |

---

## 5. Mechanism — recommendation

**Recommended: A2-cron backbone + A1 best-effort event fast-path (an "A3-lite" with the cron as the durable retry layer instead of a new queue table).**

- **Event endpoints (E1–E4, future E7/E8)** call an idempotent, **fire-and-forget** `requestReconcile(workspaceId)` (does not block the HTTP response; failures are swallowed *by design* because the cron backstops). Gives users the fast "agents restarted" outcome they're promised.
- **Cron (§6)** is the source of truth and safety net: it re-derives expected env, detects drift, and (in AUTO-HEAL) reconciles anything the event path missed or that failed.

**Why not the others:**
- **A1 alone** swallows redeploy errors with no retry → silent drift on transient Railway failures. Rejected as the *sole* mechanism.
- **A2 alone** has a multi-minute drift window after every credential change → the `switch-source` UX ("~30 seconds") stays false. Rejected as the *sole* mechanism.
- **A3 with a new `pending_reconciliations` table/queue** adds schema + a worker for a guarantee the **idempotent cron already provides**. Rejected for scope; the cron *is* the durable retry layer. (If event volume ever needs backpressure, A3's table can be added later without changing the contract.)

This reuses the existing cron pattern (`reconcile-credit-balances`) and `redeployWorkspace()` — minimal new surface, with the cron's idempotency (I5) guaranteeing the event fast-path and the cron can never conflict or loop.

---

## 6. Reconciliation cron spec (the safety net)

- **Route:** `GET /api/cron/reconcile-container-env`. **Auth:** `Bearer ${CRON_SECRET}` (verbatim from `reconcile-credit-balances/route.ts:9-12`). `export const maxDuration = 60`.
- **Schedule (milestone progression):**
  - DETECT-ONLY: `*/15 * * * *` (bounds Railway API load during the observation window).
  - AUTO-HEAL initial: `*/15` stays for the first 24h after the flip (prove healing is safe at the slow cadence first).
  - AUTO-HEAL stable: tighten to `*/5 * * * *` after 24h of clean AUTO-HEAL, matching `reconcile-credit-balances` cadence — shipped as **PR-8c** (a `vercel.json` schedule + log-threshold change only; no logic change). Rationale: the cron is the backstop, and the per-event fast-path (§5, PR-8b) is what actually delivers the `switch-source` "~30 seconds" promise — but the backstop cadence still needs to be tighter than `*/15` once healing is trusted. Added to `vercel.json crons[]`.
- **Scope query:** `workspace.findMany({ where: { status: 'RUNNING', containerId: { not: null } } })` with `user { apiKeys, creditAccount }`.
- **Expected env:** re-derive via `getApiKeySource()` + the env-builder (a pure helper extracted from `buildRailwayEnvVars`/generator in Phase 2). Compare only the **credential-relevant** subset: `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`.
  - Credit users: `ANTHROPIC_API_KEY` is a plain Railway var (master key) → compare directly.
  - BYOK/NONE: the key lives inside `CLAWS_ENV_B64` (base64 `.env`) → decode + parse, then compare a **non-secret fingerprint** (`sha256(value)` or the stored `keyHint`).
  - **Design note — fingerprint detects *change*, not *value*:** the fingerprint proves a BYOK key drifted from DB without revealing what it changed to, and that is sufficient. The cron's job is detect-and-correct, not diagnose; the heal action is always "redeploy with the current DB-derived value" regardless of what the drifted value was. Do **not** add diagnostic detail that would require logging raw key material. The helper types it **`keyFingerprint: string | null`** (always present; `null` when no key — *not* optional), so the comparison reads it uniformly.
- **Actual env source:** Railway variables API. Requires a **read** helper `getServiceVariables(containerId)` on the Railway client (write-side `updateServiceVariables` exists; the read is a Phase-2 add). Fallback option (if Railway read is unreliable): a container plugin "report current env fingerprint" endpoint — deferred unless needed.
- **Drift evaluation — transient-window exclusions (a delta is NOT counted as `drift_detected` unless ALL hold):**
  - (a) Workspace `status === 'RUNNING'` at comparison time (already required by the §4 scope guard).
  - (b) **≥60s elapsed since the workspace's latest `Deployment.completedAt`** — guards against reading a mid-redeploy window where Railway vars are applied but the container hasn't fully cut over (partial-update false positive).
  - (c) Workspace `status` did **not** change between the DB read and the Railway read — re-read `status` after the Railway call; if it changed, discard the comparison and re-evaluate next tick.
  A delta that fails (a)/(b)/(c) is logged at `info` as `event: "drift_skipped_transient"` (so suppression rates are observable), **never** as `drift_detected`.
- **Mode flag:** `ENV_RECONCILE_MODE = "detect_only" | "auto_heal"` (default `detect_only`). In `auto_heal`, after logging drift, call `redeployWorkspace(workspaceId)` subject to §4 cooldown/cap/lock.
- **Log shape (for the Axiom dashboard alert) — never log raw secrets:**
  - Per drift: `log.warn("container env drift detected", { category: "env_reconciliation", event: "drift_detected", workspaceId, userId, field: "credit_mode" | "anthropic_key" | "base_url", expected: <bool|hint|hash>, actual: <bool|hint|hash>, mode })`
  - Per heal (auto_heal): `log.info("container env reconciled", { category: "env_reconciliation", event: "healed", workspaceId, mode })`
  - Per error: `log.error("container env reconcile failed", { category: "env_reconciliation", event: "error", workspaceId, error, mode })`
  - Per transient skip: `log.info("container env drift skipped (transient)", { category: "env_reconciliation", event: "drift_skipped_transient", workspaceId, reason: "not_running" | "post_deploy_grace" | "status_changed_mid_window", mode })`
  - Run summary: `log.info("env reconciliation complete", { category: "env_reconciliation", event: "run_complete", checked, drifts, healed, errors, skipped, mode })`
  - **Alert:** Axiom monitor on `category="env_reconciliation" AND event="drift_detected"` (rate) and `event="error"`.
- **Security:** the cron only ever logs booleans / hints / hashes. Raw key material never leaves `decrypt()`/comparison scope.

---

## 7. Rollout plan

- **PR-8a — detection only:** this contract doc + the cron in **DETECT-ONLY** mode (`*/15`) + Railway `getServiceVariables` read helper + the env-fingerprint comparison + the transient-window exclusions (§6). Deploy; observe Axiom for a **48–72h** window.
  - **Exit criteria to flip → AUTO-HEAL (ALL required):**
    1. **Zero false positives OUTSIDE known transient windows** (§6 exclusions a/b/c) across the window. Deltas suppressed as `drift_skipped_transient` do not count; every genuine `drift_detected` must be manually confirmed against DB + Railway.
    2. **Each trigger event E1–E4 manually exercised at least once** on a test workspace, with the cron observed emitting `drift_detected` for each:
       - **E1** — add/update a BYOK key → observe `drift_detected` (field `anthropic_key`).
       - **E2** — remove the BYOK key → observe `drift_detected`.
       - **E3** — `switch-source` (credit→BYOK) → observe `drift_detected` (the canonical TODO case).
       - **E4** — credit grant to a user with a RUNNING container → observe `drift_detected` (`credit_mode` + `base_url`); skip only if no running container can be arranged for the granted user.
    3. For each detected drift, **manually confirm it matches what AUTO-HEAL would heal** (i.e., `redeployWorkspace` would produce the expected DB-derived env).
  - **Exit met = all 4 manual exercises observed + zero non-transient false positives in the window.** Record the confirmed-drift count and the 4 exercise log links in the PR-8b description.
- **PR-8b — the fix:** event-triggered `requestReconcile()` wired into E1–E4 (+ the `switch-source` message becomes truthful) + cron flipped to **AUTO-HEAL** (stays at `*/15` for the first 24h) + cooldown/cap/lock. **Pre-merge: complete the §7.5 staging log check.** Contract tests assert I1–I6 and the §4 policies; a regression test asserts `switch-source` actually triggers reconcile (locks in the TODO fix).
- **PR-8c — cadence tighten:** after **24h of clean AUTO-HEAL at `*/15`**, tighten the cron to `*/5` (`vercel.json` schedule + any log-volume threshold). Small standalone PR, **no logic change**. Rationale: the `switch-source` UX promise needs a backstop faster than `*/15` once healing is trusted.

## 7.5. Pre-PR-8b staging log check (a pre-merge gate for PR-8b, not a separate PR)

Before PR-8b merges, query staging Axiom for historical `"Container recycle needed"` entries (emitted by `switch-source/route.ts:35`, `reason: "API_KEY_SOURCE_CHANGED"`). **Each entry is a real user who hit the E3 lie** — told "agents will restart in ~30s" while nothing recycled — and is therefore running on **stale env**.
- If any exist: **manually reconcile those workspaces** (redeploy with current DB state) *before* PR-8b's auto-fix lands, so (a) those users stop running on a stale key sooner and (b) AUTO-HEAL doesn't first encounter them as a surprise batch of drifts on flip day.
- Record the affected `workspaceId`s and confirm each is reconciled. This is a checklist item in the PR-8b description, gated before merge.

---

## 8. Out of scope (tracked elsewhere)

- **E5 exhaustion behavior** changes under **PR-9** (per-Claw subscription model: exhaustion no longer destroys containers — see the `exhaustion.ts:26-34` TODO). PR-8 leaves E5 as-is.
- **`isValid` flag** flips (E6) — deliberately not a trigger.
- **Subscription eligibility** (`hasActiveSubscription`) — affects deploy gating, not the API-key value; out of scope for key reconciliation.
- **WIRE-TEST cleanup** — operational (reprovision as a proper credit user once 3a/3b is confirmed), not code.

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
| A-cron-heal | AUTO-HEAL logs drift **and** calls `redeployWorkspace` | §6 |
| A-log-shape | drift/heal/error/summary/transient-skip logs carry the fixed `category`+fields; no raw secrets | §6 |
| A-fingerprint | BYOK key comparison uses a value fingerprint (sha256/keyHint), not raw/encrypted-blob equality | §6 |
| A-grace | a delta within 60s of `Deployment.completedAt`, or with a status change mid-window, is suppressed as `drift_skipped_transient` (not `drift_detected`) | §6/§7 |

---

## 10. Non-goals / derivation scope (why `deriveContainerEnv` is Anthropic-only)

`deriveContainerEnv` (`src/lib/openclaw/derive-container-env.ts`) is deliberately scoped to the **credit-mode / Anthropic credential triple** (`ANTHROPIC_API_KEY`, `CLAWS_CREDIT_MODE`, `ANTHROPIC_BASE_URL`, plus the drift `keyFingerprint`) because that triple — and only that triple — is what *drifts* between DB state and a running container when a user's `apiKeySource` or keys change. It is the contract surface for this reconciliation effort, not a general-purpose provider-env manager. As of PR-8a it is the single source of truth for the two paths that inject those vars into a live container: the deploy path (`deployer.ts:buildRailwayEnvVars`) and the runtime secret-fetch path (`container-secrets/route.ts`). The remaining emission of `ANTHROPIC_API_KEY` in the codebase — `generator.ts` baking it into the workspace `.env` (`generator.ts:647`) — is **intentionally left separate**: the generator is a multi-provider `.env` baker that provisions *every* configured provider key for the workspace (Anthropic, OpenAI, etc. — see `generator.ts:84`), which is a workspace-provisioning concern unrelated to credit-mode drift. Folding it into `deriveContainerEnv` today would force an Anthropic-only helper to grow multi-provider responsibilities it doesn't need. If multi-provider metering is ever introduced (the platform currently meters only `provider="ANTHROPIC"` in `report-batch`), the expansion path is: extend `deriveContainerEnv` to emit the full provider set, then unify `generator.ts`'s `.env` baking onto it — at which point the "single source of truth" guarantee extends to all providers. Until then, `generator.ts` is the documented, expected exception, and the §9 assertions cover only the Anthropic/credit-mode surface.
