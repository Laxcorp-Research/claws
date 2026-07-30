/**
 * WIRE-FULL topology + deploy validation (extends requiredToolsSatisfied pattern).
 *
 * Topology law (solid edges):
 *   ORCH→WORKER = "delegates to" (only legal solid edge)
 *   No WORKER→WORKER, *→ORCH, CRITIC→*, WORKER→CRITIC, self/duplicate
 *
 * HARD block: zero ORCH→WORKER edges, or critic missing from the team.
 * SOFT warning: edge-orphaned worker(s), named.
 */

export type TopologyAgent = {
  id: string
  name: string
  role: string
}

export type TopologyEdge = {
  sourceAgentId: string
  targetAgentId: string
}

export type TopologyHardError =
  | { code: "CRITIC_MISSING"; message: string }
  | { code: "NO_ORCH_WORKER_EDGES"; message: string }
  | { code: "ILLEGAL_EDGE"; message: string; edge: TopologyEdge }

export type TopologySoftWarning = {
  code: "ORPHANED_WORKER"
  message: string
  workerName: string
}

export type TopologyValidation = {
  hardErrors: TopologyHardError[]
  softWarnings: TopologySoftWarning[]
  ok: boolean
}

export const TOPOLOGY_NO_WORKER_COPY =
  "Add a worker and connect it to your Commander."

export function isLegalSolidEdge(args: {
  sourceRole: string
  targetRole: string
  sourceId: string
  targetId: string
}): boolean {
  if (args.sourceId === args.targetId) return false
  return args.sourceRole === "ORCHESTRATOR" && args.targetRole === "WORKER"
}

export function validateTopology(args: {
  agents: TopologyAgent[]
  edges: TopologyEdge[]
}): TopologyValidation {
  const hardErrors: TopologyHardError[] = []
  const softWarnings: TopologySoftWarning[] = []

  const byId = new Map(args.agents.map((a) => [a.id, a]))
  const orch = args.agents.find((a) => a.role === "ORCHESTRATOR")
  const critic = args.agents.find((a) => a.role === "CRITIC")
  const workers = args.agents.filter((a) => a.role === "WORKER")

  if (!critic) {
    hardErrors.push({
      code: "CRITIC_MISSING",
      message: "Every team needs a reviewer — the Critic agent is missing.",
    })
  }

  let orchWorkerEdges = 0
  const seen = new Set<string>()

  for (const edge of args.edges) {
    const key = `${edge.sourceAgentId}->${edge.targetAgentId}`
    if (seen.has(key)) {
      hardErrors.push({
        code: "ILLEGAL_EDGE",
        message: "Duplicate connection — remove the extra edge.",
        edge,
      })
      continue
    }
    seen.add(key)

    const source = byId.get(edge.sourceAgentId)
    const target = byId.get(edge.targetAgentId)
    if (!source || !target) continue

    if (
      !isLegalSolidEdge({
        sourceRole: source.role,
        targetRole: target.role,
        sourceId: source.id,
        targetId: target.id,
      })
    ) {
      hardErrors.push({
        code: "ILLEGAL_EDGE",
        message: illegalEdgeMessage(source.role, target.role),
        edge,
      })
      continue
    }

    if (source.role === "ORCHESTRATOR" && target.role === "WORKER") {
      orchWorkerEdges++
    }
  }

  if (orch && orchWorkerEdges === 0) {
    hardErrors.push({
      code: "NO_ORCH_WORKER_EDGES",
      message: TOPOLOGY_NO_WORKER_COPY,
    })
  }

  // Soft: workers with no inbound ORCH→WORKER edge.
  if (orch) {
    const reached = new Set(
      args.edges
        .filter((e) => e.sourceAgentId === orch.id)
        .map((e) => e.targetAgentId),
    )
    for (const w of workers) {
      if (!reached.has(w.id)) {
        softWarnings.push({
          code: "ORPHANED_WORKER",
          workerName: w.name,
          message: `${w.name} is not connected — it won't receive work`,
        })
      }
    }
  }

  return {
    hardErrors,
    softWarnings,
    ok: hardErrors.length === 0,
  }
}

function illegalEdgeMessage(sourceRole: string, targetRole: string): string {
  if (targetRole === "CRITIC") {
    return "Review is automatic — every worker's output goes through the reviewer before it reaches you."
  }
  if (sourceRole === "WORKER" && (targetRole === "WORKER" || targetRole === "ORCHESTRATOR")) {
    return "Workers don't hand off directly — work flows through the Commander. Results return automatically."
  }
  if (sourceRole === "CRITIC") {
    return "The reviewer doesn't delegate — review is automatic."
  }
  if (targetRole === "ORCHESTRATOR") {
    return "Workers don't hand off directly — work flows through the Commander. Results return automatically."
  }
  return "Only Commander → Worker connections are allowed."
}
