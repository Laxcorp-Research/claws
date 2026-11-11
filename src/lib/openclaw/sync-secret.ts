import { prisma } from "@/lib/db"
import { decrypt, encrypt } from "@/lib/encryption"
import { mintSyncSecret } from "@/lib/openclaw/sync-channel"

/** Ciphertext stored on Workspace at create, and on first use if the column is empty. */
export function encryptedSyncSecret(): string {
  return encrypt(mintSyncSecret())
}

/**
 * Plaintext secret injected as CLAWS_METERING_SECRET and sent as
 * X-Metering-Secret. Lazy-mints so a workspace created before this column
 * existed can nap after the app upgrade.
 */
export async function ensureWorkspaceSyncSecret(workspaceId: string): Promise<string> {
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { syncSecretEncrypted: true },
  })
  if (!row) {
    throw new Error(`workspace ${workspaceId} not found`)
  }
  if (row.syncSecretEncrypted) {
    try {
      return decrypt(row.syncSecretEncrypted)
    } catch {
      // Unreadable ciphertext is reminted below.
    }
  }
  const secret = mintSyncSecret()
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { syncSecretEncrypted: encrypt(secret) },
  })
  return secret
}
