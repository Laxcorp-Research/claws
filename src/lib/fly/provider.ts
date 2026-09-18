/**
 * Provider-per-workspace resolution (RAILWAY | FLY).
 *
 * - `Workspace.provider` is the stamped truth once set to FLY.
 * - `NEW_WORKSPACE_PROVIDER=FLY` (cutover flag): NEVER-provisioned
 *   workspaces (zero COMPLETED/SUPERSEDED deployments, no containerId) are
 *   stamped FLY at their FIRST deploy. Existing claws are untouched - they
 *   migrate on natural wake via MIGRATE_ON_WAKE_TO (see hibernation
 *   manager), never mid-flight.
 * - Rollback for new deploys = unset the env var (already-stamped FLY
 *   workspaces keep running on Fly; per-claw rollback = flip the column
 *   back to RAILWAY and redeploy - the service pool provisions instantly).
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { isFlyConfigured } from "@/lib/fly/machines-client"

export type WorkspaceCloudProvider = "RAILWAY" | "FLY"

export function newWorkspaceProviderFlag(
  raw = process.env.NEW_WORKSPACE_PROVIDER,
): WorkspaceCloudProvider {
  return raw?.trim().toUpperCase() === "FLY" ? "FLY" : "RAILWAY"
}

export function migrateOnWakeTarget(
  raw = process.env.MIGRATE_ON_WAKE_TO,
): WorkspaceCloudProvider | null {
  return raw?.trim().toUpperCase() === "FLY" ? "FLY" : null
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
