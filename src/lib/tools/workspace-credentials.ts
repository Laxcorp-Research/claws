/**
 * Workspace-scoped credential read. Rig workspaces carry their own keys.
 * Never fall back to a founder / sibling workspace.
 *
 * MUTATION: drop workspaceId from the Prisma where, or add an OR / in: list
 * of other workspace ids → workspace-credentials.test.ts fails.
 */
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"

export type WorkspaceToolCredentialMap = Record<string, string>

function parseCredentialMap(plaintext: string): WorkspaceToolCredentialMap | null {
  const parsed = JSON.parse(plaintext) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const env: WorkspaceToolCredentialMap = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) env[key] = value
  }
  return Object.keys(env).length > 0 ? env : null
}

export async function resolveWorkspaceToolCredentials(
  workspaceId: string,
  toolSlug: string,
): Promise<WorkspaceToolCredentialMap | null> {
  if (!workspaceId.trim()) {
    throw new Error("workspaceId is required")
  }
  if (!toolSlug.trim()) {
    throw new Error("toolSlug is required")
  }

  const row = await prisma.toolConnection.findFirst({
    where: { workspaceId, toolSlug },
    select: { encryptedCredentials: true },
  })
  if (!row?.encryptedCredentials) return null
  try {
    return parseCredentialMap(decrypt(row.encryptedCredentials))
  } catch {
    return null
  }
}
