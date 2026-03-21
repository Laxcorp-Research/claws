import { BUILTIN_SKILLS } from "./skills-builtin"
import { TOOL_SPECIFIC_SKILLS } from "./skills-tool-specific"
import { TOOL_AGNOSTIC_SKILLS } from "./skills-agnostic"
import { DOMAIN_WORKFLOW_SKILLS } from "./skills-domain"
import type { SeedSkill } from "./types"

export const ALL_SKILLS: SeedSkill[] = [
  ...BUILTIN_SKILLS,
  ...TOOL_SPECIFIC_SKILLS,
  ...TOOL_AGNOSTIC_SKILLS,
  ...DOMAIN_WORKFLOW_SKILLS,
]

const slugs = ALL_SKILLS.map((s) => s.slug)
const uniqueSlugs = new Set(slugs)
if (slugs.length !== uniqueSlugs.size) {
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  throw new Error("Duplicate skill slugs: " + dupes.join(", "))
}
