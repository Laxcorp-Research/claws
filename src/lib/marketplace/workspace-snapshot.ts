/**
 * Single workspaceSnapshot builder for seed + community publish.
 * Seed and publish must never drift on choreography / honesty fields.
 */

export type SnapshotDeliveryMode = "APPROVAL_REQUIRED" | "AUTO_PROCEED"

export type SnapshotAgentInput = {
  name: string
  agentSlug: string
  role: string
  color?: string | null
  model: string
  roleDescription?: string | null
  description?: string | null
  soulMd: string
  agentsMd: string
  heartbeatMd?: string | null
  heartbeatFrequency?: string | null
  heartbeatTime?: string | null
  toolsMd?: string | null
  userMd?: string | null
  identityMd?: string | null
  fallbackModel?: string | null
  reportsTo?: string | null
  maxRetries?: number | null
  qualityThreshold?: number | null
  positionX?: number | null
  positionY?: number | null
  /** Seed: string[]; publish: { slug, name, configOverrides }[] */
  skills?: unknown
}

export type SnapshotConnectionInput = {
  sourceSlug?: string
  targetSlug?: string
  sourceAgentId?: string
  targetAgentId?: string
  condition: string
  conditionExpr?: string | null
  label?: string | null
}

export type SnapshotToolInput = {
  slug: string
  name: string
  category?: string
  connectionType: string
  required: boolean
  alternatives?: string[]
}

/** Birth stubs. Path is relative to each agent workspace (e.g. memory/MEMORY.md). */
export type SnapshotSeedFileInput = {
  path: string
  content: string
}

export type WorkspaceSnapshotPayload = {
  agents: SnapshotAgentInput[]
  connections: SnapshotConnectionInput[]
  tools: SnapshotToolInput[]
  flowDescription?: string | null
  legalDisclaimer?: string | null
  maxRevisionRounds: number
  deliveryMode: SnapshotDeliveryMode
  recommendedAlwaysOn?: boolean
  /**
   * Seed-only. Community publish must omit this key (privacy rail v1).
   * Not a parity key - publish and seed are allowed to differ here.
   */
  files?: SnapshotSeedFileInput[]
}

/** Canonical keys every writer must be able to emit (mutation-tested). */
export const WORKSPACE_SNAPSHOT_PARITY_KEYS = [
  "agents",
  "connections",
  "tools",
  "flowDescription",
  "legalDisclaimer",
  "maxRevisionRounds",
  "deliveryMode",
  "recommendedAlwaysOn",
] as const

export function buildWorkspaceSnapshotObject(
  payload: WorkspaceSnapshotPayload,
): Record<string, unknown> {
  const deliveryMode: SnapshotDeliveryMode =
    payload.deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "APPROVAL_REQUIRED"

  const obj: Record<string, unknown> = {
    agents: payload.agents,
    connections: payload.connections,
    tools: payload.tools,
    flowDescription: payload.flowDescription ?? null,
    legalDisclaimer: payload.legalDisclaimer ?? null,
    maxRevisionRounds:
      typeof payload.maxRevisionRounds === "number" && payload.maxRevisionRounds > 0
        ? payload.maxRevisionRounds
        : 3,
    deliveryMode,
  }

  if (payload.recommendedAlwaysOn === true) {
    obj.recommendedAlwaysOn = true
  }

  // Seed path only. Publish builder never passes files - do not add a default.
  if (payload.files && payload.files.length > 0) {
    obj.files = payload.files
  }

  return obj
}

export function buildWorkspaceSnapshotJson(payload: WorkspaceSnapshotPayload): string {
  return JSON.stringify(buildWorkspaceSnapshotObject(payload))
}

/**
 * Seed authoring is `string[]`. Install's snapshotSkillSlug only reads
 * `{ slug | skillSlug }` on objects - a bare string was silently skipped.
 * Normalize here so reseeded templates materialize AgentSkill rows.
 */
export function normalizeSeedAgentSkills(skills: unknown): Array<{ slug: string }> {
  if (!Array.isArray(skills)) return []
  const out: Array<{ slug: string }> = []
  for (const entry of skills) {
    if (typeof entry === "string") {
      const slug = entry.trim()
      if (slug) out.push({ slug })
      continue
    }
    if (entry && typeof entry === "object") {
      const rec = entry as { slug?: unknown; skillSlug?: unknown }
      const raw =
        typeof rec.slug === "string"
          ? rec.slug
          : typeof rec.skillSlug === "string"
            ? rec.skillSlug
            : ""
      const slug = raw.trim()
      if (slug) out.push({ slug })
    }
  }
  return out
}

/** SeedTemplate-shaped input (prisma/seed-data). */
export function buildWorkspaceSnapshotFromSeedTemplate(template: {
  agents: Array<{
    name: string
    agentSlug: string
    role: string
    color: string
    model: string
    roleDescription: string
    soulMd: string
    agentsMd: string
    heartbeatMd: string
    skills: string[]
    position: { x: number; y: number }
    qualityThreshold?: number
  }>
  connections: SnapshotConnectionInput[]
  tools: SnapshotToolInput[]
  flowDescription: string
  legalDisclaimer?: string
  recommendedAlwaysOn?: boolean
  knobs?: { maxRevisionRounds: number; deliveryMode: SnapshotDeliveryMode }
  files?: SnapshotSeedFileInput[]
}): string {
  const knobs = template.knobs ?? {
    maxRevisionRounds: 3,
    deliveryMode: "APPROVAL_REQUIRED" as const,
  }

  return buildWorkspaceSnapshotJson({
    agents: template.agents.map((a) => ({
      name: a.name,
      agentSlug: a.agentSlug,
      role: a.role,
      color: a.color,
      model: a.model,
      roleDescription: a.roleDescription,
      soulMd: a.soulMd,
      agentsMd: a.agentsMd,
      heartbeatMd: a.heartbeatMd,
      skills: normalizeSeedAgentSkills(a.skills),
      positionX: a.position.x,
      positionY: a.position.y,
      ...(a.role === "CRITIC"
        ? { qualityThreshold: a.qualityThreshold ?? 8 }
        : a.qualityThreshold != null
          ? { qualityThreshold: a.qualityThreshold }
          : {}),
    })),
    connections: template.connections,
    tools: template.tools,
    flowDescription: template.flowDescription,
    legalDisclaimer: template.legalDisclaimer ?? null,
    maxRevisionRounds: knobs.maxRevisionRounds,
    deliveryMode: knobs.deliveryMode,
    recommendedAlwaysOn: template.recommendedAlwaysOn === true ? true : undefined,
    files: template.files && template.files.length > 0 ? template.files : undefined,
  })
}

export type WorkspaceForSnapshot = {
  maxRevisionRounds: number
  deliveryMode: SnapshotDeliveryMode | string
  alwaysOn?: boolean
  description?: string | null
  agents: Array<{
    id: string
    name: string
    agentSlug: string
    role: string
    roleDescription?: string | null
    description?: string | null
    color?: string | null
    icon?: string | null
    soulMd: string
    agentsMd: string
    heartbeatMd?: string | null
    heartbeatFrequency?: string | null
    heartbeatTime?: string | null
    toolsMd?: string | null
    userMd?: string | null
    identityMd?: string | null
    model: string
    fallbackModel?: string | null
    reportsTo?: string | null
    maxRetries?: number | null
    qualityThreshold?: number | null
    positionX?: number | null
    positionY?: number | null
    skills: Array<{
      configOverrides?: string | null
      skill: { slug: string; name: string }
    }>
  }>
  connections: Array<{
    sourceAgentId: string
    targetAgentId: string
    condition: string
    conditionExpr?: string | null
    label?: string | null
  }>
  toolConnections: Array<{
    toolSlug: string
    displayName: string
    connectionType: string
  }>
}

/** Build snapshot payload from a live user workspace (publish path). */
export function buildWorkspaceSnapshotFromWorkspace(
  workspace: WorkspaceForSnapshot,
  extras?: {
    flowDescription?: string | null
    legalDisclaimer?: string | null
    recommendedAlwaysOn?: boolean
  },
): string {
  const slugById = new Map(workspace.agents.map((a) => [a.id, a.agentSlug]))

  return buildWorkspaceSnapshotJson({
    agents: workspace.agents.map((a) => ({
      name: a.name,
      agentSlug: a.agentSlug,
      role: a.role,
      roleDescription: a.roleDescription,
      description: a.description,
      color: a.color,
      icon: a.icon,
      soulMd: a.soulMd,
      agentsMd: a.agentsMd,
      heartbeatMd: a.heartbeatMd,
      heartbeatFrequency: a.heartbeatFrequency,
      heartbeatTime: a.heartbeatTime,
      toolsMd: a.toolsMd,
      userMd: a.userMd,
      identityMd: a.identityMd,
      model: a.model,
      fallbackModel: a.fallbackModel,
      reportsTo: a.reportsTo,
      maxRetries: a.maxRetries,
      qualityThreshold: a.qualityThreshold,
      positionX: a.positionX,
      positionY: a.positionY,
      skills: a.skills.map((s) => ({
        slug: s.skill.slug,
        name: s.skill.name,
        configOverrides: s.configOverrides,
      })),
    })),
    connections: workspace.connections.map((c) => ({
      sourceAgentId: c.sourceAgentId,
      targetAgentId: c.targetAgentId,
      sourceSlug: slugById.get(c.sourceAgentId),
      targetSlug: slugById.get(c.targetAgentId),
      condition: c.condition,
      conditionExpr: c.conditionExpr,
      label: c.label,
    })),
    tools: workspace.toolConnections.map((t) => ({
      slug: t.toolSlug,
      name: t.displayName,
      connectionType: t.connectionType,
      required: true,
    })),
    flowDescription: extras?.flowDescription ?? workspace.description ?? null,
    legalDisclaimer: extras?.legalDisclaimer ?? null,
    maxRevisionRounds: workspace.maxRevisionRounds,
    deliveryMode:
      workspace.deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "APPROVAL_REQUIRED",
    recommendedAlwaysOn:
      extras?.recommendedAlwaysOn === true || workspace.alwaysOn === true ? true : undefined,
  })
}
