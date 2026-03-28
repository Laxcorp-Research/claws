import { prisma } from "@/lib/db"

const BUNDLED_OPENCLAW_SKILLS = new Set([
  "weather", "github", "web-search", "calculator", "clock",
  "file-read", "file-write", "shell", "http", "json",
  "csv", "markdown", "regex", "crypto", "base64",
])

export function extractSkillSlugsFromSnapshot(
  snapshot: Record<string, unknown>
): string[] {
  const slugs = new Set<string>()
  const agents = (snapshot.agents as Array<Record<string, unknown>>) || []

  for (const agent of agents) {
    const skills = (agent.skills as Array<Record<string, unknown>>) || []
    for (const skill of skills) {
      const slug = (skill.slug as string) || (skill.skillSlug as string)
      if (slug) slugs.add(slug)
    }
  }

  return Array.from(slugs)
}

export async function validateSkillDependencies(
  snapshot: Record<string, unknown>
): Promise<{ valid: boolean; missing: string[] }> {
  const referencedSlugs = extractSkillSlugsFromSnapshot(snapshot)

  if (referencedSlugs.length === 0) {
    return { valid: true, missing: [] }
  }

  const nonBundled = referencedSlugs.filter((s) => !BUNDLED_OPENCLAW_SKILLS.has(s))

  if (nonBundled.length === 0) {
    return { valid: true, missing: [] }
  }

  const marketplaceSkills = await prisma.marketplaceSkill.findMany({
    where: { slug: { in: nonBundled }, isPublished: true },
    select: { slug: true },
  })

  const availableSlugs = new Set(marketplaceSkills.map((s) => s.slug))

  const builtInSkills = await prisma.skill.findMany({
    where: { slug: { in: nonBundled } },
    select: { slug: true },
  })
  for (const s of builtInSkills) availableSlugs.add(s.slug)

  const missing = nonBundled.filter((s) => !availableSlugs.has(s))

  return { valid: missing.length === 0, missing }
}
