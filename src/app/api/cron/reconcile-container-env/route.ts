import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"
import { log } from "@/lib/logger"
import { deriveContainerEnv, fingerprintKey } from "@/lib/openclaw/derive-container-env"
import { getServiceVariables, RailwayApiError } from "@/lib/openclaw/railway-client"
import { parseClawsEnvPayload, type RawContainerEnv } from "@/lib/openclaw/container-env-actual"
import { resolveMode } from "@/lib/openclaw/reconcile-mode"
import { healWorkspace } from "@/lib/openclaw/heal-workspace"

// PR-8a/C — Container env reconciliation cron (DETECT-ONLY).
//
// The PR-8 safety net: per RUNNING workspace, compare the container's ACTUAL
// credential env (read off Railway, decoded from CLAWS_ENV_GZ_B64 / legacy
// CLAWS_ENV_B64) against the
// EXPECTED env derived from current DB state (deriveContainerEnv). When they
// drift, log it — DETECT-ONLY does NOT auto-heal (PR-8b adds AUTO-HEAL behind
// ENV_RECONCILE_MODE=auto_heal). See docs/CONTAINER_ENV_RECONCILIATION_CONTRACT.md.
//
// PR-8a/C/A (this file) is the skeleton: auth + per-tick lock + scope query +
// rotation + summary accumulator + a no-op loop body. PR-8a/C/B fills in the
// per-workspace comparison; PR-8a/C/C adds the transient-window exclusions.

export const maxDuration = 55

// Per-tick processing cap (contract §6). Bounds Railway reads + tick duration;
// the oldest-first ordering (lastEnvReconcileAt ASC NULLS FIRST) + the
// post-check stamp give fair rotation so no workspace starves under the cap.
//
// PR-8c: capped at 10 per tick to bound worst-case duration.
// At */5 cadence with cap=10 = 120 workspaces/hr throughput
// (vs */15 × 20 = 80/hr — higher cadence + smaller batch is net better).
// Bounds against: (a) Railway read timeouts (10s × cap), (b) heal triggers
// (~2-3s × cap). Worst case 40-50s comfortably under maxDuration=55s.
const RECONCILE_MAX_PER_RUN = 10

const TICK_LOCK_KEY = "reconcile:env:tick"
// TTL safety net (> maxDuration) in case the explicit release never runs (e.g.
// the function is killed mid-tick). The happy path is the finally-block del.
const TICK_LOCK_TTL_SEC = 65

// PR-8a/C/C: transient-window grace. A workspace whose most-recent deployment
// completed within this window is skipped (its env may still be settling after
// a deploy/redeploy). Strict less-than, so exactly RECONCILE_GRACE_MS proceeds.
const RECONCILE_GRACE_MS = 60_000

// PR-8b/B: resolveMode() + ReconcileMode moved to @/lib/openclaw/reconcile-mode
// (the shared gate, imported above). The in-route copy — and its
// auto_heal→detect_only downgrade-with-warning — is gone: auto_heal is REAL now.
// The shared resolveMode still fails closed (throws) on any invalid value.

type RailwayErrorKind =
  | "railway_auth"
  | "railway_not_found"
  | "railway_rate_limited"
  | "railway_5xx"
  | "railway_timeout"
  | "railway_network"

type SkipReason =
  | "recent_deploy"
  | "deploy_in_progress"
  | "status_changed_midwindow"
  | "no_deployment_record"
  | "workspace_deleted_midwindow"
  | "tick_capped"
  // PR-8b/B: AUTO-HEAL was suppressed because the per-workspace cooldown lock is
  // held (a recent heal — cron or event fast-path). Counted under summary.skipped.
  | "cooldown_active"

// railwayGql collapses timeouts into a status-0 "network error" RailwayApiError
// with the original message embedded, so timeout-vs-generic-network is a
// best-effort split on the message. Both mean "couldn't read"; the split is for
// observability only.
function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /abort|timed?\s*out|timeout/i.test(msg)
}

// Map a Railway read failure to a structured errorKind via the typed
// RailwayApiError.status discriminator (PR-8a/B).
function classifyRailwayError(err: unknown): RailwayErrorKind {
  if (err instanceof RailwayApiError) {
    if (err.status === 401) return "railway_auth"
    if (err.status === 404) return "railway_not_found"
    if (err.status === 429) return "railway_rate_limited"
    if (err.status >= 500) return "railway_5xx"
    if (err.status === 0) return isTimeoutError(err) ? "railway_timeout" : "railway_network"
    return "railway_network" // any other status (e.g. GraphQL errors[] on a 2xx)
  }
  return isTimeoutError(err) ? "railway_timeout" : "railway_network"
}

// The container's ACTUAL Anthropic key fingerprint. Credit mode keeps the
// master key as a top-level Railway var; BYOK bakes the user key into
// CLAWS_ENV_GZ_B64 / legacy CLAWS_ENV_B64 (.env). Returns null when no key is present. Mirrors the
// pipeline validated in container-env-pipeline.test.ts. Never logs the key.
function extractActualKeyFingerprint(actual: RawContainerEnv): string | null {
  const key =
    actual.CLAWS_CREDIT_MODE === "true"
      ? actual.ANTHROPIC_API_KEY ?? null
      : parseClawsEnvPayload(actual).ANTHROPIC_API_KEY ?? null
  return key ? fingerprintKey(key) : null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const mode = resolveMode()

  // Per-tick lock: prevent overlapping ticks (manual GET triggers / retries;
  // Vercel generally won't overlap cron invocations, but we don't rely on
  // that). DETECT-ONLY is read-only + idempotent, so if Redis is unreachable
  // we log and proceed WITHOUT the lock rather than skip the safety net.
  // PR-8b (AUTO-HEAL) will need stricter handling — no heal without a lock.
  let lockAcquired: unknown = null
  let lockSkipped = false
  try {
    lockAcquired = await redis.set(TICK_LOCK_KEY, "1", { nx: true, ex: TICK_LOCK_TTL_SEC })
  } catch (err) {
    lockSkipped = true
    log.error("env reconciliation: lock acquisition failed (Redis) — proceeding lock-less (detect-only is idempotent)", {
      category: "env_reconciliation",
      event: "lock_error",
      error: String(err),
    })
  }
  if (!lockSkipped && !lockAcquired) {
    log.info("env reconciliation tick skipped (lock held)", {
      category: "env_reconciliation",
      event: "tick_skipped_locked",
    })
    return Response.json({ success: true, data: { skipped: "locked" } })
  }

  const startedAt = Date.now()
  const summary = {
    checked: 0,
    drifts: 0,
    healed: 0, // PR-8b/B: drift workspaces successfully redeployed (auto_heal only)
    skipped: {
      recent_deploy: 0,
      deploy_in_progress: 0,
      status_changed_midwindow: 0,
      no_deployment_record: 0,
      workspace_deleted_midwindow: 0,
      tick_capped: 0,
      cooldown_active: 0, // PR-8b/B: heal suppressed by the per-workspace cooldown lock
    },
    errors: {
      railway_auth: 0,
      railway_not_found: 0,
      railway_rate_limited: 0,
      railway_5xx: 0,
      railway_timeout: 0,
      railway_network: 0,
      db_read: 0,
      decrypt: 0,
      heal_error: 0, // PR-8b/B: redeployWorkspace threw during an auto_heal
    },
    mode,
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      where: { status: "RUNNING", containerId: { not: null } },
      orderBy: { lastEnvReconcileAt: { sort: "asc", nulls: "first" } },
      take: RECONCILE_MAX_PER_RUN,
      select: {
        id: true,
        containerId: true,
        status: true,
        apiKeySourceOverride: true,
        user: {
          select: {
            apiKeySource: true,
            apiKeys: { select: { provider: true, encryptedKey: true } },
          },
        },
      },
    })

    // Rotate the cursor regardless of per-workspace outcome (success, drift, or
    // error) so a failing workspace can't get stuck at the front of the
    // oldest-first queue and starve the rest.
    const stamp = async (workspaceId: string) => {
      try {
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { lastEnvReconcileAt: new Date() },
        })
      } catch (err) {
        summary.errors.db_read++
        log.error("env reconciliation: failed to stamp lastEnvReconcileAt", {
          category: "env_reconciliation",
          event: "error",
          errorKind: "db_read",
          workspaceId,
          error: String(err),
        })
      }
    }

    // Structured "skipped (transient)" log + counter. Transient signals (deploy
    // windows, mid-window status changes) must NEVER surface as drift_detected.
    const logSkip = (reason: SkipReason, workspaceId: string, extra: Record<string, unknown> = {}) => {
      log.info("env reconciliation skipped (transient)", {
        category: "env_reconciliation",
        event: "drift_skipped_transient",
        workspaceId,
        reason,
        ...extra,
      })
      summary.skipped[reason]++
    }

    for (const ws of workspaces) {
      const containerId = ws.containerId! // scope query filters containerId NOT NULL

      // (a) EXPECTED env from current DB state.
      const expected = deriveContainerEnv(ws, ws.user)

      // (b) ACTUAL env off the live Railway service, on a tight budget so one
      // slow/hung read can't blow the tick. Per-workspace error isolation:
      // classify, count, rotate, and move on.
      let actual: RawContainerEnv
      try {
        actual = await getServiceVariables(containerId, { timeoutMs: 10_000, maxRetries: 1 })
      } catch (err) {
        const errorKind = classifyRailwayError(err)
        summary.errors[errorKind]++
        log.error("env reconciliation: Railway read failed", {
          category: "env_reconciliation",
          event: "error",
          errorKind,
          workspaceId: ws.id,
          containerIdTail: containerId.slice(-8),
        })
        await stamp(ws.id)
        continue
      }

      // Transient-window exclusions (PR-8a/C/C). Re-read the workspace AFTER the
      // Railway read: anything that changed during the read window (a status
      // flip, a deploy that started/finished) is a transient signal, not drift.
      // Every exclusion below is drift_skipped_transient, NEVER drift_detected.
      // The .catch isolates a DB hiccup to this workspace (it can't 500 the tick).
      const after = await prisma.workspace
        .findUnique({
          where: { id: ws.id },
          select: {
            status: true,
            deployments: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { completedAt: true, status: true },
            },
          },
        })
        .catch((err) => {
          summary.errors.db_read++
          log.error("env reconciliation: workspace re-read failed", {
            category: "env_reconciliation",
            event: "error",
            errorKind: "db_read",
            workspaceId: ws.id,
            error: String(err),
          })
          return undefined // sentinel: re-read failed (distinct from null = deleted)
        })

      if (after === undefined) continue // re-read failed; error already counted. Retry next tick.
      if (after === null) {
        // Deleted between the scope query and the re-read — no row left to stamp.
        logSkip("workspace_deleted_midwindow", ws.id)
        continue
      }
      if (after.status !== "RUNNING") {
        logSkip("status_changed_midwindow", ws.id, { statusBefore: ws.status, statusAfter: after.status })
        await stamp(ws.id)
        continue
      }
      const latestDeployment = after.deployments[0]
      if (!latestDeployment) {
        logSkip("no_deployment_record", ws.id)
        await stamp(ws.id)
        continue
      }
      if (latestDeployment.completedAt === null) {
        logSkip("deploy_in_progress", ws.id, { deploymentStatus: latestDeployment.status })
        await stamp(ws.id)
        continue
      }
      const msAgo = Date.now() - latestDeployment.completedAt.getTime()
      if (msAgo < RECONCILE_GRACE_MS) {
        logSkip("recent_deploy", ws.id, { msAgo })
        await stamp(ws.id)
        continue
      }

      // (c) ACTUAL key fingerprint. parseClawsEnvB64 is total, so this should
      // never throw — the guard is defensive (closest errorKind: "decrypt").
      let actualFingerprint: string | null
      try {
        actualFingerprint = extractActualKeyFingerprint(actual)
      } catch (err) {
        summary.errors.decrypt++
        log.error("env reconciliation: failed to extract actual key fingerprint", {
          category: "env_reconciliation",
          event: "error",
          errorKind: "decrypt",
          workspaceId: ws.id,
          error: String(err),
        })
        await stamp(ws.id)
        continue
      }

      // (d) Three-field comparison.
      const actualCreditMode = actual.CLAWS_CREDIT_MODE === "true"
      const expectedBaseUrl = expected.ANTHROPIC_BASE_URL ?? null
      const actualBaseUrl = actual.ANTHROPIC_BASE_URL ?? null
      const driftFields: string[] = []
      if (expected.CLAWS_CREDIT_MODE !== actualCreditMode) driftFields.push("credit_mode")
      if (expectedBaseUrl !== actualBaseUrl) driftFields.push("base_url")
      if (expected.keyFingerprint !== actualFingerprint) driftFields.push("key_fp")

      // (e) Drift log — fingerprints/booleans only, never raw key material.
      if (driftFields.length > 0) {
        summary.drifts++
        log.warn("env drift detected", {
          category: "env_reconciliation",
          event: "drift_detected",
          workspaceId: ws.id,
          driftFields,
          expected: {
            credit_mode: expected.CLAWS_CREDIT_MODE,
            base_url: expectedBaseUrl,
            key_fp: expected.keyFingerprint,
          },
          actual: {
            credit_mode: actualCreditMode,
            base_url: actualBaseUrl,
            key_fp: actualFingerprint,
          },
          mode: summary.mode,
        })

        // (e2) AUTO-HEAL (PR-8b/B). In auto_heal mode, redeploy to re-apply the
        // DB-derived env. healWorkspace is the shared cooldown-gated core (also
        // used by the event fast-path), so the cron and events can never
        // double-fire a restart on the same workspace. detect_only never reaches
        // this branch (gated below), and healWorkspace re-checks the mode itself.
        if (mode === "auto_heal") {
          const heal = await healWorkspace(ws.id)
          if (!heal.ok) {
            summary.errors.heal_error++
            log.error("env reconciliation: heal failed", {
              category: "env_reconciliation",
              event: "heal_error",
              workspaceId: ws.id,
              error: heal.error,
              mode,
            })
          } else if (heal.action === "healed") {
            summary.healed++
            log.info("env reconciliation: workspace healed", {
              category: "env_reconciliation",
              event: "healed",
              workspaceId: ws.id,
              mode,
            })
          } else if (heal.action === "cooldown_skipped") {
            summary.skipped.cooldown_active++
            log.info("env reconciliation: heal skipped (cooldown active)", {
              category: "env_reconciliation",
              event: "heal_skipped_cooldown",
              workspaceId: ws.id,
              mode,
            })
          } else {
            // detect_only_noop: mode is auto_heal here, so the shared gate should
            // never return this. Surface loudly if the two ever disagree.
            log.warn("env reconciliation: unexpected detect_only_noop under auto_heal", {
              category: "env_reconciliation",
              event: "heal_unexpected_noop",
              workspaceId: ws.id,
              mode,
            })
          }
        }
      }

      // (f) rotate + (g) count the completed comparison.
      await stamp(ws.id)
      summary.checked++
    }
  } finally {
    if (!lockSkipped) {
      try {
        await redis.del(TICK_LOCK_KEY)
      } catch (err) {
        // The EX TTL is the backstop — the lock auto-expires in TICK_LOCK_TTL_SEC
        // even if this del fails. Log, don't fail the tick.
        log.warn("env reconciliation: lock release failed — relying on TTL expiry", {
          category: "env_reconciliation",
          event: "lock_release_failed",
          error: String(err),
        })
      }
    }
  }

  const durationMs = Date.now() - startedAt
  log.info("env reconciliation complete", {
    category: "env_reconciliation",
    event: "run_complete",
    durationMs,
    ...summary,
  })

  return Response.json({ success: true, data: { ...summary, durationMs } })
}
