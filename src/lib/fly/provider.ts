/**
 * Provider-per-workspace resolution (RAILWAY | FLY).
 *
 * Phase 0 cancelled the Fly track. `newWorkspaceProviderFlag` always
 * returns RAILWAY and `migrateOnWakeTarget` always returns null, so the
 * cutover env vars are ignored. A row already stamped FLY still resolves
 * to the Fly deployer; production has none.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { isFlyConfigured } from "@/lib/fly/machines-client"

export type WorkspaceCloudProvider = "RAILWAY" | "FLY"

export function newWorkspaceProviderFlag(
  _raw = process.env.NEW_WORKSPACE_PROVIDER,
): WorkspaceCloudProvider {
  // Phase 0: Fly track cancelled. NEW_WORKSPACE_PROVIDER=FLY is ignored.
  return "RAILWAY"
}

export function migrateOnWakeTarget(
  _raw = process.env.MIGRATE_ON_WAKE_TO,
): WorkspaceCloudProvider | null {
  // Phase 0: no wake-time migration onto Fly.
  return null
}

/**
 * Effective provider for a deploy. Stamps FLY on first-ever provision when
 * the cutover flag is on; otherwise returns the stored provider.
 */
export async function resolveEffectiveProvider(workspace: {
  id: string
  provider: WorkspaceCloudProvider | string
  containerId: string | null
}): Promise<WorkspaceCloudProvider> {
  if (workspace.provider === "FLY") return "FLY"

  if (
    newWorkspaceProviderFlag() === "FLY" &&
    isFlyConfigured() &&
    !workspace.containerId
  ) {
    const everProvisioned = await prisma.deployment.count({
      where: {
        workspaceId: workspace.id,
        status: { in: ["COMPLETED", "SUPERSEDED"] },
      },
    })
    if (everProvisioned === 0) {
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { provider: "FLY" },
      })
      log.info("provider: new workspace stamped FLY (NEW_WORKSPACE_PROVIDER)", {
        workspaceId: workspace.id,
      })
      return "FLY"
    }
  }

  return "RAILWAY"
}
