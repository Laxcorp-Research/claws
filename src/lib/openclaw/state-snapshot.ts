import { createHash, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import { isSelfHost } from "@/lib/profile"
import { writeRuntimeSnapshotToDisk } from "@/lib/openclaw/snapshot-disk"

/**
 * Pre-migration pin trigger: the workspace is deployed on a different
 * contract than the bytes currently stored, a current snapshot exists, and
 * the pre-migration slot is free (empty or past its 7-day pin). Evaluated
 * against the OLD row values inside the single UPDATE below.
 */
const PRE_MIGRATION_SHIFT = Prisma.raw(`(
      "deployedRuntimeContract" IS NOT NULL
      AND "runtimeStateContract" IS NOT NULL
      AND "runtimeStateContract" <> "deployedRuntimeContract"
      AND "runtimeStateSnapshot" IS NOT NULL
      AND ("preMigrationSnapshot" IS NULL OR "preMigrationPinnedUntil" < NOW())
    )`)

/**
 * Single atomic persist for ContainerState.runtimeStateSnapshot.
 *
 * INVARIANT: ONE statement - never read-modify-write of the snapshot columns.
 * Used only by Blob /finalize (inline /upload is reject-only).
 *
 * Snapshot generations (rollback material): every persist shifts
 * current -> runtimeStatePrevSnapshot in the same UPDATE, so at least two
 * generations always exist. The first persist after a contract change
 * (deployedRuntimeContract vs runtimeStateContract) additionally copies the
 * outgoing snapshot into preMigrationSnapshot, pinned for 7 days.
 *
 * Founder-claw regression this closes (2026-09-13): a single-column overwrite
 * destroyed the last 5.22-shaped snapshot the moment the first 9.4 persist
 * landed - the rollback material was gone. In Postgres every column reference
 * on the right-hand side of SET reads the OLD tuple, so the shift and the
 * overwrite are one atomic step.
 */
export async function persistRuntimeStateSnapshot(args: {
  workspaceId: string
  stateBuffer: Buffer
  uncompressedSize: number
}): Promise<{ count: number }> {
  const count = await prisma.$executeRaw`
    UPDATE "ContainerState" SET
      "preMigrationSnapshot"    = CASE WHEN ${PRE_MIGRATION_SHIFT} THEN "runtimeStateSnapshot" ELSE "preMigrationSnapshot" END,
      "preMigrationContract"    = CASE WHEN ${PRE_MIGRATION_SHIFT} THEN "runtimeStateContract" ELSE "preMigrationContract" END,
      "preMigrationTakenAt"     = CASE WHEN ${PRE_MIGRATION_SHIFT} THEN "runtimeStateUpdatedAt" ELSE "preMigrationTakenAt" END,
      "preMigrationPinnedUntil" = CASE WHEN ${PRE_MIGRATION_SHIFT} THEN NOW() + interval '7 days' ELSE "preMigrationPinnedUntil" END,
      "runtimeStatePrevSnapshot"  = "runtimeStateSnapshot",
      "runtimeStatePrevUpdatedAt" = "runtimeStateUpdatedAt",
      "runtimeStatePrevSizeBytes" = "runtimeStateSizeBytes",
      "runtimeStateSnapshot"  = ${args.stateBuffer},
      "runtimeStateUpdatedAt" = NOW(),
      "runtimeStateSizeBytes" = ${args.uncompressedSize || 0},
      "runtimeStateContract"  = COALESCE("deployedRuntimeContract", "runtimeStateContract")
    WHERE "workspaceId" = ${args.workspaceId}
  `
  if (isSelfHost()) {
    await writeRuntimeSnapshotToDisk(args.workspaceId, args.stateBuffer)
  }
  return { count }
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const aa = a.toLowerCase()
  const bb = b.toLowerCase()
  if (aa.length !== bb.length || aa.length === 0) return false
  const ba = Buffer.from(aa, "utf8")
  const bbuf = Buffer.from(bb, "utf8")
  if (ba.length !== bbuf.length) return false
  return timingSafeEqual(ba, bbuf)
}

/** Hash currently persisted snapshot bytes, or null if absent. */
export async function readPersistedSnapshotSha256(
  workspaceId: string,
): Promise<string | null> {
  const row = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: { runtimeStateSnapshot: true },
  })
  if (!row?.runtimeStateSnapshot) return null
  return sha256Hex(Buffer.from(row.runtimeStateSnapshot))
}
