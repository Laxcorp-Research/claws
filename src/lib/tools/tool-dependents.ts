/**
 * Tool → agent impact map for REMOVE warning copy (tool customization PR-2).
 *
 * Structural: Skill.compatibleTools → AgentSkill → Agent
 * Prose: soulMd / agentsMd / heartbeatMd mention tool name or slug
 *
 * Honest limit: official templates often seed skills:[] and install never
 * creates AgentSkill - prose is the common signal. SOUL-only paraphrases
 * that omit the tool name/slug are undetectable.
 */
import { prisma } from "@/lib/db"
import { getToolBySlug } from "@/data/tool-catalog"

export type DependentHitKind = "structural" | "prose"

export interface ToolDependentHit {
  agentId: string
  agentName: string
  agentSlug: string
  kind: DependentHitKind
  /** Skill slugs (structural) or matched needles (prose). */
  details: string[]
}

export interface ResolveToolDependentsResult {
  hits: ToolDependentHit[]
  /** structural | prose | both | none - drives honest-limit dialog copy. */
  coverage: "structural" | "prose" | "both" | "none"
  honestLimitCopy: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Case-insensitive whole-ish match for slug or display name in agent prose. */
export function proseMentionsTool(
  text: string | null | undefined,
  slug: string,
  displayName: string,
): string[] {
  if (!text) return []
  const needles = Array.from(
    new Set(
      [slug, displayName, slug.replace(/_/g, "-"), slug.replace(/-/g, "_")].filter(
        (n) => n.trim().length > 0,
      ),
    ),
  )
  const matched: string[] = []
  for (const needle of needles) {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`, "i")
    if (re.test(text)) matched.push(needle)
  }
  return matched
}

export function honestLimitCopyForCoverage(
  coverage: ResolveToolDependentsResult["coverage"],
): string {
  switch (coverage) {
    case "none":
      return "No agents reference this tool in assigned skills or SOUL/AGENTS/HEARTBEAT text. Prose-only paraphrases without the tool name may still exist - review agent files if unsure."
    case "prose":
      return "Listed agents mention this tool in SOUL/AGENTS/HEARTBEAT text only - no assigned skills link it. Mentions that omit the tool name are not detected."
    case "structural":
      return "Listed agents have skills compatible with this tool. SOUL/AGENTS prose that names the tool without a skill assignment is not listed separately when a structural hit already exists."
    case "both":
      return "Includes skill assignments and SOUL/AGENTS/HEARTBEAT text mentions. Paraphrases that omit the tool name may still be missed."
  }
}

export async function resolveToolDependents(
  workspaceId: string,
  toolSlug: string,
): Promise<ResolveToolDependentsResult> {
  const slug = toolSlug.trim()
  if (!slug) {
    return {
      hits: [],
      coverage: "none",
      honestLimitCopy: honestLimitCopyForCoverage("none"),
    }
  }

  const displayName = getToolBySlug(slug)?.name ?? slug
  const byAgent = new Map<string, ToolDependentHit>()

  const compatibleSkills = await prisma.skill.findMany({
    where: { compatibleTools: { has: slug } },
    select: { id: true, slug: true, name: true },
  })

  if (compatibleSkills.length > 0) {
    const agentSkills = await prisma.agentSkill.findMany({
      where: {
        skillId: { in: compatibleSkills.map((s) => s.id) },
        agent: { workspaceId },
      },
      select: {
        agent: { select: { id: true, name: true, agentSlug: true } },
        skill: { select: { slug: true } },
      },
    })

    for (const row of agentSkills) {
      const existing = byAgent.get(row.agent.id)
      if (existing) {
        if (existing.kind === "structural") {
          existing.details.push(row.skill.slug)
        } else {
          // Prefer structural over prose for the same agent.
          byAgent.set(row.agent.id, {
            agentId: row.agent.id,
            agentName: row.agent.name,
            agentSlug: row.agent.agentSlug,
            kind: "structural",
            details: [row.skill.slug],
          })
        }
      } else {
        byAgent.set(row.agent.id, {
          agentId: row.agent.id,
          agentName: row.agent.name,
          agentSlug: row.agent.agentSlug,
          kind: "structural",
          details: [row.skill.slug],
        })
      }
    }
  }

  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      agentSlug: true,
      soulMd: true,
      agentsMd: true,
      heartbeatMd: true,
    },
  })

  for (const agent of agents) {
    if (byAgent.has(agent.id) && byAgent.get(agent.id)!.kind === "structural") {
      continue
    }
    const matches = [
      ...proseMentionsTool(agent.soulMd, slug, displayName),
      ...proseMentionsTool(agent.agentsMd, slug, displayName),
      ...proseMentionsTool(agent.heartbeatMd, slug, displayName),
    ]
    if (matches.length === 0) continue
    if (byAgent.has(agent.id)) continue
    byAgent.set(agent.id, {
      agentId: agent.id,
      agentName: agent.name,
      agentSlug: agent.agentSlug,
      kind: "prose",
      details: Array.from(new Set(matches)),
    })
  }

  const hits = Array.from(byAgent.values()).sort((a, b) =>
    a.agentName.localeCompare(b.agentName),
  )
  const hasStructural = hits.some((h) => h.kind === "structural")
  const hasProse = hits.some((h) => h.kind === "prose")
  const coverage: ResolveToolDependentsResult["coverage"] =
    hasStructural && hasProse
      ? "both"
      : hasStructural
        ? "structural"
        : hasProse
          ? "prose"
          : "none"

  return {
    hits,
    coverage,
    honestLimitCopy: honestLimitCopyForCoverage(coverage),
  }
}

/** Format hits for dialog: "Trend Scout (2 skills)" / "Writer (mentioned in SOUL/AGENTS)". */
export function formatDependentHitLabel(hit: ToolDependentHit): string {
  if (hit.kind === "structural") {
    const n = hit.details.length
    return `${hit.agentName} (${n} skill${n === 1 ? "" : "s"})`
  }
  return `${hit.agentName} (mentioned in SOUL/AGENTS)`
}
