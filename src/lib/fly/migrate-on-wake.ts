/**
 * Fly cutover: migrate an existing RAILWAY claw to FLY on NATURAL WAKE when
 * MIGRATE_ON_WAKE_TO=FLY is armed.
 *
 * Lives OUTSIDE hibernation/manager.ts on purpose: the HWD source contract
 * (hibernate-without-delete.test.ts) forbids the manager from ever writing
 * `containerId: null` - hibernation must never detach a claw from its
 * container. Migration is the one legitimate detach: the hibernated Railway
 * service (deployment already removed) is recycled into the service pool,
 * the workspace is stamped FLY, and the wake fresh-provisions on Fly. The
 * platform snapshot restore is provider-neutral (CLAWS_*_GZ_B64 payloads),
 * and `preMigrationSnapshot` pins the last pre-migration generation for 7
 * days - same rollback mechanism as the 9.4 runtime migration.
 *
 * Per-claw rollback: flip Workspace.provider back to RAILWAY and wake again
 * (the pool provisions a service instantly).
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { migrateOnWakeTarget } from "@/lib/fly/provider"
import { isFlyConfigured } from "@/lib/fly/machines-client"

export type MigrateOnWakeResult = { migrated: boolean }

export async function maybeMigrateToFlyOnWake(workspace: {
  id: string
  provider: string
  containerId: string | null
}): Promise<MigrateOnWakeResult> {
  if (
    migrateOnWakeTarget() !== "FLY" ||
    workspace.provider !== "RAILWAY" ||
    !isFlyConfigured()
  ) {
    return { migrated: false }
  }

  if (workspace.containerId) {
    const { recycleServiceIntoPool } = await import("@/lib/railway/service-pool")
    const recycled = await recycleServiceIntoPool({
      serviceId: workspace.containerId,
      workspaceId: workspace.id,
    })
    log.info("wake migration: Railway service released to pool", {
      workspaceId: workspace.id,
      serviceId: workspace.containerId,
      outcome: recycled.outcome,
    })
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: {
      provider: "FLY",
      containerId: null,
      containerName: null,
      containerHost: null,
    },
  })
  log.info("wake migration: workspace stamped FLY (migrate-on-wake)", {
    workspaceId: workspace.id,
  })
  return { migrated: true }
}
