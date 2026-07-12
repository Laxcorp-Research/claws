import { createHash, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/db"

/**
 * Single atomic persist for ContainerState.runtimeStateSnapshot.
 * INVARIANT: one updateMany — never read-modify-write of the snapshot columns.
 * Used only by Blob /finalize (inline /upload is reject-only).
 */
export async function persistRuntimeStateSnapshot(args: {
  workspaceId: string
  stateBuffer: Buffer
  uncompressedSize: number
}): Promise<{ count: number }> {
  const { count } = await prisma.containerState.updateMany({
    where: { workspaceId: args.workspaceId },
    data: {
      runtimeStateSnapshot: new Uint8Array(args.stateBuffer),
      runtimeStateUpdatedAt: new Date(),
      runtimeStateSizeBytes: args.uncompressedSize || 0,
    },
  })
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
