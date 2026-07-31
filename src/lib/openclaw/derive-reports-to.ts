/**
 * reportsTo = projection from edges (WIRE-FULL §7).
 * Worker's announce target = orchestrator. Column stays; API writers removed.
 */

export type ReportsToAgent = { id: string; role: string }
export type ReportsToEdge = { sourceAgentId: string; targetAgentId: string }

/**
 * For each WORKER with an inbound ORCH→WORKER edge, reportsTo = orch.id.
 * Workers with no inbound orch edge → null (orphaned).
 * Critic / orch → null.
 */
export function deriveReportsToMap(args: {
  agents: ReportsToAgent[]
  edges: ReportsToEdge[]
}): Map<string, string | null> {
  const orch = args.agents.find((a) => a.role === "ORCHESTRATOR")
  const map = new Map<string, string | null>()
  for (const a of args.agents) {
    map.set(a.id, null)
  }
  if (!orch) return map

  for (const edge of args.edges) {
    if (edge.sourceAgentId !== orch.id) continue
    const target = args.agents.find((a) => a.id === edge.targetAgentId)
    if (target?.role === "WORKER") {
      map.set(target.id, orch.id)
    }
  }
  return map
}
