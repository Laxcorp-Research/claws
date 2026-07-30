/**
 * Server-side deploy gate for WIRE-FULL topology (sibling to required-tools).
 * Hard-blocks when validateTopology reports hardErrors.
 */
import { prisma } from "@/lib/db"
import {
  validateTopology,
  type TopologyHardError,
  type TopologySoftWarning,
  type TopologyValidation,
} from "@/lib/openclaw/validate-topology"

export type DeployTopologyPrerequisites = TopologyValidation & {
  primaryMessage: string | null
}

/**
 * Evaluate canvas topology for deploy / redeploy.
 * MUTATION: remove call from cloud/redeploy routes → topology bypass tests fail.
 */
export async function evaluateWorkspaceDeployTopologyPrerequisites(
  workspaceId: string,
): Promise<DeployTopologyPrerequisites> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      agents: { select: { id: true, name: true, role: true } },
      connections: { select: { sourceAgentId: true, targetAgentId: true } },
    },
  })

  const result = validateTopology({
    agents: workspace.agents,
    edges: workspace.connections,
  })

  return {
    ...result,
    primaryMessage: primaryHardMessage(result.hardErrors),
  }
}

export function primaryHardMessage(errors: TopologyHardError[]): string | null {
  if (errors.length === 0) return null
  // Prefer actionable "add a worker" copy when present.
  const noWorker = errors.find((e) => e.code === "NO_ORCH_WORKER_EDGES")
  if (noWorker) return noWorker.message
  return errors[0]!.message
}

export type { TopologyHardError, TopologySoftWarning }
