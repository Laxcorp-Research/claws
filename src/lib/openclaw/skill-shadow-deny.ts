/**
 * When an attached skill replaces a bundled OpenClaw tool, deny the bundled
 * name so agents cannot call the shadow (fire #3: tavily-search attached,
 * agents still called web_search / kimi).
 *
 * MUTATION: drop mergeSkillShadowDenyIntoTools from generator.ts →
 * generator.test.ts fails.
 */

export const SKILL_SHADOWS_BUNDLED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  "tavily-search": ["web_search"],
  "brave-search": ["web_search"],
}

export function collectAttachedSkillSlugs(workspace: {
  agents?: Array<{ skills?: Array<{ skill?: { slug?: string } }> }>
}): string[] {
  const slugs = new Set<string>()
  for (const agent of workspace.agents ?? []) {
    for (const row of agent.skills ?? []) {
      const slug = row.skill?.slug?.trim()
      if (slug) slugs.add(slug)
    }
  }
  return [...slugs]
}

export function bundledToolsShadowedBySkills(skillSlugs: readonly string[]): string[] {
  const denied = new Set<string>()
  for (const slug of skillSlugs) {
    const shadows = SKILL_SHADOWS_BUNDLED_TOOLS[slug]
    if (!shadows) continue
    for (const tool of shadows) denied.add(tool)
  }
  return [...denied]
}

export function mergeDenyNamesIntoTools(
  existingTools: Record<string, unknown> | undefined,
  names: readonly string[],
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) }
  const existingDeny = Array.isArray(tools.deny)
    ? (tools.deny as unknown[]).filter((d): d is string => typeof d === "string")
    : []
  const next = [...existingDeny]
  for (const name of names) {
    if (!next.includes(name)) next.push(name)
  }
  tools.deny = next
  return tools
}

export function mergeSkillShadowDenyIntoTools(
  existingTools: Record<string, unknown> | undefined,
  skillSlugs: readonly string[],
): Record<string, unknown> {
  return mergeDenyNamesIntoTools(existingTools, bundledToolsShadowedBySkills(skillSlugs))
}

export function disableBundledWebSearch(
  existingTools: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) }
  const web =
    typeof tools.web === "object" && tools.web && !Array.isArray(tools.web)
      ? { ...(tools.web as Record<string, unknown>) }
      : {}
  const search =
    typeof web.search === "object" && web.search && !Array.isArray(web.search)
      ? { ...(web.search as Record<string, unknown>) }
      : {}
  search.enabled = false
  web.search = search
  tools.web = web
  return tools
}
