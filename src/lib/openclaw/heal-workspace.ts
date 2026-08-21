import { redis } from "@/lib/redis"
import { log } from "@/lib/logger"
import { redeployWorkspace } from "@/lib/openclaw/deployer"
import { resolveMode } from "@/lib/openclaw/reconcile-mode"

// Per-workspace AUTO-HEAL cooldown (contract §4). Prevents the cron and the
// event fast-path from double-redeploying the same workspace inside this window
// (default 30 min). A heal also creates a fresh Deployment, so the cron's 60s
// grace window suppresses the immediate next compare regardless - the cooldown
// is the longer-horizon guard against redeploy churn.
export const RECONCILE_COOLDOWN_SEC = 1800

const cooldownKey = (workspaceId: string) => `reconcile:cooldown:${workspaceId}`

export type HealResult =
  | { ok: true; action: "healed" | "cooldown_skipped" | "detect_only_noop" }
  | { ok: false; error: string }

/**
 * Shared AUTO-HEAL core for BOTH the reconciliation cron and the event-triggered
 * fast-path. The single behavior gate for healing:
 *   - detect_only → no-op (no lock, no redeploy). The `ENV_RECONCILE_MODE=
 *     auto_heal` flag-flip is the one switch that turns healing on everywhere.
 *   - auto_heal   → acquire a per-workspace NX cooldown lock, then redeploy.
 *
 * Cooldown discipline (contract §4):
 *   - Acquired with SET NX BEFORE the redeploy, so a concurrent cron+event pair
 *     can't double-fire a restart on the same workspace.
 *   - RELEASED (DEL) if the redeploy throws, so a FAILED heal is retried on the
 *     next tick rather than locked out for the whole window. A successful heal
 *     keeps the lock until its TTL expires.
 *   - If Redis is unreachable we do NOT heal (no lock ⇒ no heal); the cron
 *     backstops on a later tick. AUTO-HEAL must never redeploy lock-less.
 *
 * Total function: never throws - returns a HealResult the caller summarizes.
 */
export async function healWorkspace(workspaceId: string): Promise<HealResult> {
  if (resolveMode() === "detect_only") {
    return { ok: true, action: "detect_only_noop" }
  }

  let acquired: unknown
  try {
    acquired = await redis.set(cooldownKey(workspaceId), "1", { nx: true, ex: RECONCILE_COOLDOWN_SEC })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error("healWorkspace: cooldown acquire failed (Redis) - skipping heal (no lock, no heal)", {
      category: "env_reconciliation",
      event: "heal_lock_error",
      workspaceId,
      error,
    })
    return { ok: false, error }
  }

  if (!acquired) {
    return { ok: true, action: "cooldown_skipped" }
  }

  try {
    await redeployWorkspace(workspaceId)
    log.info("healWorkspace: redeploy triggered", {
      category: "env_reconciliation",
      event: "healed",
      workspaceId,
    })
    return { ok: true, action: "healed" }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    // Release the cooldown so the next tick can retry this FAILED heal.
    try {
      await redis.del(cooldownKey(workspaceId))
    } catch (delErr) {
      log.error("healWorkspace: cooldown release failed after heal error - TTL will expire it", {
        category: "env_reconciliation",
        event: "heal_lock_release_failed",
        workspaceId,
        error: delErr instanceof Error ? delErr.message : String(delErr),
      })
    }
    log.error("healWorkspace: redeploy failed", {
      category: "env_reconciliation",
      event: "heal_error",
      workspaceId,
      error,
    })
    return { ok: false, error }
  }
}
