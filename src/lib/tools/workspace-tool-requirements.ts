/**
 * Per-workspace tool requirement set (tool customization PR-1).
 *
 * Source of truth after install: Workspace.toolRequirements (JSON copy of
 * template snapshot tools[]). Legacy null → fall back to template snapshot.
 * All consumers must route through resolveWorkspaceToolRequirements.
 */
import { prisma } from "@/lib/db"
import { isAiProviderSlug } from "@/lib/tools/required-tools"

export interface WorkspaceToolRequirement {
  slug: string
  name: string
  category: string
  connectionType: string
  required: boolean
  alternatives?: string[]
  dismissed?: boolean
}

export type ToolRequirementOpName =
  | "demote"
  | "restore"
  | "dismiss"
  | "undismiss"
  | "remove"

export interface ToolRequirementOp {
  op: ToolRequirementOpName
  slug: string
}

export type ResolveSource = "workspace" | "template" | "empty"

export interface ResolvedWorkspaceToolRequirements {
  tools: WorkspaceToolRequirement[]
  source: ResolveSource
  clawTemplateId: string | null
  templateSlug: string | null
}

export interface PartitionedToolRequirements {
  /** All non-removed entries (includes dismissed recommended). */
  tools: WorkspaceToolRequirement[]
  /** required === true (AI providers not filtered here). */
  required: WorkspaceToolRequirement[]
  /** required === false && !dismissed — Step-2 Recommended render-data. */
  recommended: WorkspaceToolRequirement[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeEntry(raw: unknown): WorkspaceToolRequirement | null {
  if (!isRecord(raw)) return null
  if (typeof raw.slug !== "string" || raw.slug.trim().length === 0) return null
  if (typeof raw.name !== "string") return null
  if (typeof raw.category !== "string") return null
  if (typeof raw.connectionType !== "string") return null
  if (typeof raw.required !== "boolean") return null

  const entry: WorkspaceToolRequirement = {
    slug: raw.slug,
    name: raw.name,
    category: raw.category,
    connectionType: raw.connectionType,
    required: raw.required,
  }
  if (Array.isArray(raw.alternatives)) {
    const alts = raw.alternatives.filter((a): a is string => typeof a === "string")
    if (alts.length > 0) entry.alternatives = alts
  }
  if (raw.dismissed === true) entry.dismissed = true
  return entry
}

/** Parse Workspace.toolRequirements JSON; null/invalid → null (trigger fallback). */
export function parseToolRequirements(raw: unknown): WorkspaceToolRequirement[] | null {
  if (raw == null) return null
  if (typeof raw === "string") {
    try {
      return parseToolRequirements(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  if (!Array.isArray(raw)) return null
  const tools: WorkspaceToolRequirement[] = []
  for (const item of raw) {
    const entry = normalizeEntry(item)
    if (entry) tools.push(entry)
  }
  return tools
}

/** Extract tools[] from a template workspaceSnapshot (string or object). */
export function parseToolsFromTemplateSnapshot(snapshot: unknown): WorkspaceToolRequirement[] {
  let parsed: unknown = snapshot
  if (typeof snapshot === "string") {
    try {
      parsed = JSON.parse(snapshot) as unknown
    } catch {
      return []
    }
  }
  if (!isRecord(parsed)) return []
  return parseToolRequirements(parsed.tools) ?? []
}

/**
 * Clone snapshot tools for Workspace.toolRequirements at install.
 * Dismissed defaults absent/false (omitted).
 */
export function cloneToolsForWorkspaceSeed(
  snapshotTools: unknown,
): WorkspaceToolRequirement[] {
  const tools = parseToolRequirements(snapshotTools) ?? []
  return tools.map((t) => {
    const { dismissed: _dismissed, ...rest } = t
    return { ...rest }
  })
}

export function partitionToolRequirements(
  tools: WorkspaceToolRequirement[],
): PartitionedToolRequirements {
  const required = tools.filter((t) => t.required)
  const recommended = tools.filter((t) => !t.required && t.dismissed !== true)
  return { tools, required, recommended }
}

export interface WorkspaceToolRequirementView extends WorkspaceToolRequirement {
  /** True when this entry differs from the template default for the same slug. */
  customized: boolean
}

/** Compare workspace set to template defaults (demote / dismiss / extras). */
export function withCustomizationFlags(
  tools: WorkspaceToolRequirement[],
  templateDefaults: WorkspaceToolRequirement[],
): WorkspaceToolRequirementView[] {
  const bySlug = new Map(templateDefaults.map((t) => [t.slug, t]))
  return tools.map((t) => {
    const def = bySlug.get(t.slug)
    if (!def) return { ...t, customized: true }
    const customized =
      t.required !== def.required || t.dismissed === true
    return { ...t, customized }
  })
}

export async function resolveWorkspaceToolRequirements(
  workspaceId: string,
): Promise<ResolvedWorkspaceToolRequirements> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      toolRequirements: true,
      clawTemplateId: true,
      clawTemplate: { select: { id: true, slug: true, workspaceSnapshot: true } },
    },
  })

  if (!workspace) {
    return { tools: [], source: "empty", clawTemplateId: null, templateSlug: null }
  }

  const fromWorkspace = parseToolRequirements(workspace.toolRequirements)
  if (fromWorkspace !== null) {
    return {
      tools: fromWorkspace,
      source: "workspace",
      clawTemplateId: workspace.clawTemplateId,
      templateSlug: workspace.clawTemplate?.slug ?? null,
    }
  }

  if (workspace.clawTemplate) {
    return {
      tools: parseToolsFromTemplateSnapshot(workspace.clawTemplate.workspaceSnapshot),
      source: "template",
      clawTemplateId: workspace.clawTemplateId,
      templateSlug: workspace.clawTemplate.slug,
    }
  }

  return {
    tools: [],
    source: "empty",
    clawTemplateId: workspace.clawTemplateId,
    templateSlug: null,
  }
}

export async function loadTemplateToolDefaults(
  clawTemplateId: string | null,
): Promise<WorkspaceToolRequirement[]> {
  if (!clawTemplateId) return []
  const template = await prisma.clawTemplate.findUnique({
    where: { id: clawTemplateId },
    select: { workspaceSnapshot: true },
  })
  if (!template) return []
  return parseToolsFromTemplateSnapshot(template.workspaceSnapshot)
}

export type ApplyToolRequirementResult =
  | { ok: true; tools: WorkspaceToolRequirement[] }
  | { ok: false; code: string; message: string; status: number }

/**
 * Pure mutation of the workspace tool-requirements set.
 * Does not touch ToolConnection rows.
 */
export function applyToolRequirementOp(
  current: WorkspaceToolRequirement[],
  op: ToolRequirementOp,
  templateDefaults: WorkspaceToolRequirement[],
): ApplyToolRequirementResult {
  const slug = typeof op.slug === "string" ? op.slug.trim() : ""
  if (!slug) {
    return { ok: false, code: "VALIDATION_ERROR", message: "slug is required", status: 400 }
  }
  if (isAiProviderSlug(slug)) {
    return {
      ok: false,
      code: "AI_PROVIDER_NOT_CUSTOMIZABLE",
      message: "AI provider tools are managed on Step 1 and cannot be customized here",
      status: 400,
    }
  }

  if (op.op === "restore") {
    const defaults = templateDefaults.find((t) => t.slug === slug)
    if (!defaults) {
      return {
        ok: false,
        code: "SLUG_NOT_IN_TEMPLATE",
        message: `Tool "${slug}" is not in the template defaults`,
        status: 400,
      }
    }
    if (isAiProviderSlug(defaults.slug)) {
      return {
        ok: false,
        code: "AI_PROVIDER_NOT_CUSTOMIZABLE",
        message: "AI provider tools are managed on Step 1 and cannot be customized here",
        status: 400,
      }
    }
    const { dismissed: _d, ...restored } = defaults
    const without = current.filter((t) => t.slug !== slug)
    return { ok: true, tools: [...without, { ...restored }] }
  }

  const index = current.findIndex((t) => t.slug === slug)
  if (index < 0) {
    return {
      ok: false,
      code: "SLUG_NOT_IN_SET",
      message: `Tool "${slug}" is not in this workspace's tool requirement set`,
      status: 400,
    }
  }

  const next = current.map((t) => ({ ...t }))
  switch (op.op) {
    case "demote":
      next[index] = { ...next[index], required: false }
      return { ok: true, tools: next }
    case "dismiss":
      next[index] = { ...next[index], dismissed: true, required: false }
      return { ok: true, tools: next }
    case "undismiss":
      next[index] = { ...next[index], dismissed: false }
      // omit false dismissed for cleaner JSON
      delete next[index].dismissed
      return { ok: true, tools: next }
    case "remove":
      return { ok: true, tools: next.filter((t) => t.slug !== slug) }
    default:
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `Unknown op "${String((op as ToolRequirementOp).op)}"`,
        status: 400,
      }
  }
}
