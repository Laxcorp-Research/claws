/**
 * Edge-derived subagents.allowAgents for the orchestrator.
 *
 * allowAgents = (ORCH→WORKER solid edge targets − paused) ∪ {critic}
 * Critic is always included (structural invariant — review is a product
 * guarantee, not a canvas choice). Edge-orphaned workers are excluded.
 */

export type DeriveAllowAgentsAgent = {
  id: string
  name: string
  role: string
  isPaused?: boolean | null
}

export type DeriveAllowAgentsEdge = {
  sourceAgentId: string
  targetAgentId: string
}

export type DeriveAllowAgentsResult = {
  allowAgents: string[]
  /** Worker agent ids reached by orch edges and not paused. */
  permittedWorkerIds: string[]
  criticId: string | null
}

/** OpenClaw agent id = kebab-case of display name (generator toAgentId). */
export function toOpenClawAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

/**
 * Derive spawn allowlist from canvas edges.
 * MUTATION: sever edge derivation → allowAgents matrix test fails.
 * MUTATION: drop critic → critic invariant test fails.
 */
export function deriveAllowAgents(args: {
  agents: DeriveAllowAgentsAgent[]
  edges: DeriveAllowAgentsEdge[]
}): DeriveAllowAgentsResult {
  const orch = args.agents.find((a) => a.role === "ORCHESTRATOR")
  const critic = args.agents.find((a) => a.role === "CRITIC")
  const workersById = new Map(
    args.agents.filter((a) => a.role === "WORKER").map((a) => [a.id, a]),
  )

  const permittedWorkerIds: string[] = []
  if (orch) {
    for (const edge of args.edges) {
      if (edge.sourceAgentId !== orch.id) continue
      const worker = workersById.get(edge.targetAgentId)
      if (!worker) continue
      if (worker.isPaused) continue
      if (!permittedWorkerIds.includes(worker.id)) {
        permittedWorkerIds.push(worker.id)
      }
    }
  }

  const allowAgentIds = permittedWorkerIds.map((id) => {
    const w = workersById.get(id)!
    return toOpenClawAgentId(w.name)
  })

  const criticId = critic ? toOpenClawAgentId(critic.name) : null
  if (criticId) {
    allowAgentIds.push(criticId)
  }

  return {
    allowAgents: allowAgentIds,
    permittedWorkerIds,
    criticId,
  }
}
