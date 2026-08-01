/**
 * Server-side deploy gate for WIRE-FULL topology (sibling to required-tools).
 * Hard-blocks when validateTopology reports hardErrors.
 *
 * Card 18 / paying-user redeploy: pre-WIRE-FULL installs may still persist
 * WORKER→CRITIC "review" edges. Those edges are display-only under current
 * law (builder-topology preview) and must NOT hard-block deploy for claws
 * that already passed setup — ignore them at the deploy gate (Phase-C
 * precedent: normalize/ignore legacy review rows; do not strand a subscriber).
 */
import { prisma } from "@/lib/db"
import {
  validateTopology,
  type TopologyAgent,
  type TopologyEdge,
  type TopologyHardError,
  type TopologySoftWarning,
  type TopologyValidation,
} from "@/lib/openclaw/validate-topology"

export type DeployTopologyPrerequisites = TopologyValidation & {
  primaryMessage: string | null
  /** Count of legacy WORKER→CRITIC rows ignored for this evaluation. */
  ignoredLegacyReviewEdges: number
}

/**
 * Drop persisted WORKER→CRITIC edges before deploy validation.
 * MUTATION: remove this filter → Card-18 canary (4 review edges) fails deploy.
 */
export function omitLegacyPersistedReviewEdges(args: {
  agents: TopologyAgent[]
  edges: TopologyEdge[]
}): { edges: TopologyEdge[]; ignored: number } {
  const byId = new Map(args.agents.map((a) => [a.id, a]))
  const kept: TopologyEdge[] = []
  let ignored = 0
  for (const edge of args.edges) {
    const source = byId.get(edge.sourceAgentId)
    const target = byId.get(edge.targetAgentId)
    if (source?.role === "WORKER" && target?.role === "CRITIC") {
      ignored++
      continue
    }
    kept.push(edge)
  }
  return { edges: kept, ignored }
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

  const { edges, ignored } = omitLegacyPersistedReviewEdges({
    agents: workspace.agents,
    edges: workspace.connections,
  })

  const result = validateTopology({
    agents: workspace.agents,
    edges,
  })

  return {
    ...result,
    ignoredLegacyReviewEdges: ignored,
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
