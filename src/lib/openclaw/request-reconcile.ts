import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { healWorkspace, type HealResult } from "@/lib/openclaw/heal-workspace"

// Event-triggered reconciliation fast-path (contract §5). The four
// credential-mutation events (E1 add key, E2 remove key, E3 switch source,
// E4 grant) are all USER-level, so one mutation can affect every RUNNING
// workspace the user owns. Fan out to each (scope mirrors the cron: RUNNING +
// containerId, which is also redeployWorkspace's Railway-branch guard).
//
// Designed to run inside `after()` (PR-8b/C) — fire-and-forget. Per-workspace
// failures are logged, never thrown; the cron backstops anything missed.
// healWorkspace is the shared gate: under detect_only every call is a no-op, so
// wiring this in (PR-8b/C) ships dormant until the auto_heal flag-flip.

export async function requestReconcileForUser(userId: string): Promise<void> {
  let workspaces: Array<{ id: string }>
  try {
    workspaces = await prisma.workspace.findMany({
      where: { userId, status: "RUNNING", containerId: { not: null } },
      select: { id: true },
    })
  } catch (err) {
    log.error("requestReconcileForUser: scope query failed", {
      category: "env_reconciliation",
      event: "reconcile_request_error",
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }

  const summary = { healed: 0, cooldown_skipped: 0, detect_only_noop: 0, errors: 0 }
  for (const ws of workspaces) {
    let result: HealResult
    try {
      result = await healWorkspace(ws.id)
    } catch (err) {
      // healWorkspace is total; this guard ensures one workspace can't abort the
      // rest of the fan-out even if that contract is ever broken.
      summary.errors++
      log.error("requestReconcileForUser: unexpected heal throw", {
        category: "env_reconciliation",
        event: "reconcile_request_error",
        userId,
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (result.ok) summary[result.action]++
    else summary.errors++
  }

  log.info("requestReconcileForUser complete", {
    category: "env_reconciliation",
    event: "reconcile_request_complete",
    userId,
    workspaces: workspaces.length,
    ...summary,
  })
}

// Single-workspace variant for future workspace-level events (contract §1.1,
// E7/E8) and for the cron's per-drift heal in PR-8b/B. Thin pass-through to the
// shared gate so cron + events share identical cooldown/mode semantics.
export async function requestReconcileWorkspace(workspaceId: string): Promise<HealResult> {
  return healWorkspace(workspaceId)
}
