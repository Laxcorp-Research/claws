/**
 * Slim hierarchy view of a template workspaceSnapshot for the store preview.
 * WIRE-FULL: solid edges are configured orch→worker; critic paths are automatic.
 */

export const STORE_HIERARCHY_LEGEND = "solid = configured · dotted = automatic"

export type HierarchyRole = "ORCHESTRATOR" | "WORKER" | "CRITIC"

export type HierarchyAgent = {
  key: string
  name: string
  role: HierarchyRole
  color: string
}

export type TemplateHierarchy = {
  orchestrator: HierarchyAgent
  workers: HierarchyAgent[]
  critic: HierarchyAgent | null
  /** Worker keys that receive a configured (solid) delegate edge. */
  solidWorkerKeys: string[]
}

const ROLE_FALLBACK: Record<HierarchyRole, string> = {
  ORCHESTRATOR: "#5BA1F5",
  WORKER: "#8BFCAE",
  CRITIC: "#A78BFA",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function parseRole(value: unknown): HierarchyRole | null {
  if (value === "ORCHESTRATOR" || value === "WORKER" || value === "CRITIC") return value
  return null
}

function agentKey(raw: Record<string, unknown>, index: number): string {
  return (
    asString(raw.agentSlug) ??
    asString(raw.id) ??
    asString(raw.name) ??
    `agent-${index}`
  )
}

function parseAgent(raw: unknown, index: number): HierarchyAgent | null {
  const obj = asRecord(raw)
  if (!obj) return null
  const role = parseRole(obj.role)
  const name = asString(obj.name)
  if (!role || !name) return null
  return {
    key: agentKey(obj, index),
    name,
    role,
    color: asString(obj.color) ?? ROLE_FALLBACK[role],
  }
}

function resolveEndpoint(
  raw: Record<string, unknown>,
  slugKey: "sourceSlug" | "targetSlug",
  idKey: "sourceAgentId" | "targetAgentId",
  byKey: Map<string, HierarchyAgent>,
): HierarchyAgent | null {
  const slug = asString(raw[slugKey])
  if (slug && byKey.has(slug)) return byKey.get(slug) ?? null
  const id = asString(raw[idKey])
  if (id && byKey.has(id)) return byKey.get(id) ?? null
  return null
}

/**
 * Parse a workspaceSnapshot (string or object) into a renderable hierarchy.
 * Returns null when the snapshot is missing, malformed, or has no orchestrator.
 */
export function parseTemplateHierarchy(snapshot: unknown): TemplateHierarchy | null {
  let root: unknown = snapshot
  if (typeof snapshot === "string") {
    const trimmed = snapshot.trim()
    if (!trimmed) return null
    try {
      root = JSON.parse(trimmed) as unknown
    } catch {
      return null
    }
  }

  const obj = asRecord(root)
  if (!obj || !Array.isArray(obj.agents)) return null

  const agents = obj.agents
    .map((a, i) => parseAgent(a, i))
    .filter((a): a is HierarchyAgent => a !== null)

  const orchestrator = agents.find((a) => a.role === "ORCHESTRATOR")
  if (!orchestrator) return null

  const workers = agents.filter((a) => a.role === "WORKER")
  const critic = agents.find((a) => a.role === "CRITIC") ?? null

  const byKey = new Map<string, HierarchyAgent>()
  for (const agent of agents) {
    byKey.set(agent.key, agent)
    byKey.set(agent.name, agent)
  }

  const solidWorkerKeys: string[] = []
  if (Array.isArray(obj.connections)) {
    for (const conn of obj.connections) {
      const rec = asRecord(conn)
      if (!rec) continue
      const source = resolveEndpoint(rec, "sourceSlug", "sourceAgentId", byKey)
      const target = resolveEndpoint(rec, "targetSlug", "targetAgentId", byKey)
      if (source?.role === "ORCHESTRATOR" && target?.role === "WORKER") {
        if (!solidWorkerKeys.includes(target.key)) solidWorkerKeys.push(target.key)
      }
    }
  }

  return {
    orchestrator,
    workers,
    critic,
    solidWorkerKeys: solidWorkerKeys.length > 0 ? solidWorkerKeys : workers.map((w) => w.key),
  }
}
