import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { SYNC_SECRET_HEADER } from "@/lib/openclaw/sync-channel"

/** F3.ii: keep X-Metering-Secret - same as existing /state/upload (not activity). */
export function assertMeteringSecret(req: NextRequest): boolean {
  const expected = process.env.METERING_MASTER_SECRET
  if (!expected) return false
  return req.headers.get(SYNC_SECRET_HEADER) === expected
}

/**
 * State sync auth. The platform metering secret still matches (hosted credit
 * containers send that value as CLAWS_METERING_SECRET). A self-host container
 * sends the per-workspace secret minted at create.
 */
export async function assertSyncCredential(
  req: NextRequest,
  workspaceId: string | null,
): Promise<boolean> {
  const provided = req.headers.get(SYNC_SECRET_HEADER)
  if (!provided) return false
  if (assertMeteringSecret(req)) return true
  if (!workspaceId) return false
  try {
    const row = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { syncSecretEncrypted: true },
    })
    if (!row?.syncSecretEncrypted) return false
    return decrypt(row.syncSecretEncrypted) === provided
  } catch {
    return false
  }
}

export function parseStoreIdFromReadWriteToken(token: string): string {
  const [, , , storeId = ""] = token.split("_")
  return storeId
}
