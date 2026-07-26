/**
 * Server-side deploy gate for required tools (Finding F / #282).
 *
 * Same predicate as Setup Step 3 client gate: resolve workspace tool
 * requirements → filter AI providers → requiredToolsSatisfied(connections).
 * One truth — no reimplementation of CONNECTED / credentialed-PENDING rules.
 */
import { prisma } from "@/lib/db"
import {
  filterNonAiProviderRequiredEntries,
  requiredToolsSatisfied,
  type RequiredToolConnection,
  type RequiredToolsSatisfaction,
} from "@/lib/tools/required-tools"
import {
  partitionToolRequirements,
  resolveWorkspaceToolRequirements,
} from "@/lib/tools/workspace-tool-requirements"

const EMPTY: RequiredToolsSatisfaction = {
  satisfied: true,
  missingSlugs: [],
  missingLabels: [],
  unverifiedCount: 0,
}

/**
 * Evaluate whether this workspace may deploy / redeploy given its required
 * tools and current ToolConnection rows.
 */
export async function evaluateWorkspaceDeployToolPrerequisites(
  workspaceId: string,
): Promise<RequiredToolsSatisfaction> {
  const resolved = await resolveWorkspaceToolRequirements(workspaceId)
  const { required } = partitionToolRequirements(resolved.tools)
  const gatedRequired = filterNonAiProviderRequiredEntries(required)
  if (gatedRequired.length === 0) return EMPTY

  const rows = await prisma.toolConnection.findMany({
    where: { workspaceId },
    select: {
      toolSlug: true,
      status: true,
      connectionType: true,
      lastError: true,
      keyHint: true,
      encryptedCredentials: true,
    },
  })

  const connections: RequiredToolConnection[] = rows.map(
    ({ encryptedCredentials, ...conn }) => ({
      ...conn,
      hasCredentials: encryptedCredentials != null,
    }),
  )

  return requiredToolsSatisfied(gatedRequired, connections)
}
