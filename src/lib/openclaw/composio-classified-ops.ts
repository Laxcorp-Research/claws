import { CHEAP_OPS } from "@/lib/composio/cheap-ops"
import {
  COMPOSIO_EXECUTE_HOST,
  matchHttpEndpoint,
} from "@/lib/openclaw/http-contract"
import {
  COMPOSIO_OP_PREFIX_BY_SKILL,
  HTTP_SKILL_BY_TOOL_SLUG,
  SKILL_HTTP_CONTRACTS,
  httpContractForSkill,
} from "@/lib/openclaw/skill-http-contracts"
import { composioOverridesForTemplate } from "@/lib/openclaw/composio-op-class"
import { TEMPLATE_SKILL_ATTACH } from "../../../prisma/seed-data/skill-attach-map"
import { TOOL_SPECIFIC_SKILLS } from "../../../prisma/seed-data/skills-tool-specific"

export type RecommendedComposioOp = {
  template: string
  skill: string
  op: string
}

const EXECUTE_OP_RE = /tools\/execute\/([A-Z][A-Z0-9_]+)/g

const CHEAP_TOOLKIT_TO_CATALOG: Readonly<Record<string, string>> = {
  gmail: "gmail",
  googlecalendar: "google_calendar",
  github: "github",
  twitter: "twitter",
  hubspot: "hubspot",
  salesforce: "salesforce",
  linkedin: "linkedin",
  slack: "slack",
  notion: "notion",
  linear: "linear",
  clickup: "clickup",
  jira: "jira",
  calendly: "calendly",
  kit: "convertkit",
  google_analytics: "google-analytics",
}

function opsFromSkillMd(skillMd: string): string[] {
  const out: string[] = []
  for (const match of skillMd.matchAll(EXECUTE_OP_RE)) {
    if (match[1]) out.push(match[1])
  }
  return out
}

function opsForComposioSkill(skill: string): string[] {
  const contract = httpContractForSkill(skill)
  if (!contract || contract.auth !== "composio") return []
  const ops = new Set<string>()
  for (const endpoint of contract.endpoints) {
    if (endpoint.operation) ops.add(endpoint.operation)
  }
  const seed = TOOL_SPECIFIC_SKILLS.find((row) => row.slug === skill)
  if (seed) {
    for (const op of opsFromSkillMd(seed.skillMd)) ops.add(op)
  }
  for (const [toolkit, cheap] of Object.entries(CHEAP_OPS)) {
    const catalog = CHEAP_TOOLKIT_TO_CATALOG[toolkit] ?? toolkit
    if (HTTP_SKILL_BY_TOOL_SLUG[catalog] === skill) ops.add(cheap.op)
  }
  return [...ops].sort()
}

/**
 * Every recommended Composio op on every seeded template. Generated from
 * toolkit prefixes + SKILL.md literals + cheap-ops, not a hand list of 1087.
 */
export function recommendedComposioOps(): RecommendedComposioOp[] {
  const rows: RecommendedComposioOp[] = []
  for (const [template, agents] of Object.entries(TEMPLATE_SKILL_ATTACH)) {
    const skills = [...new Set(Object.values(agents).flat())]
    for (const skill of skills) {
      const contract = SKILL_HTTP_CONTRACTS[skill]
      if (!contract || contract.auth !== "composio") continue
      for (const op of opsForComposioSkill(skill)) {
        rows.push({ template, skill, op })
      }
    }
  }
  return rows
}

export function uniqueRecommendedComposioOps(): string[] {
  return [...new Set(recommendedComposioOps().map((row) => row.op))].sort()
}

export function assertRecommendedOpClassified(row: RecommendedComposioOp): boolean {
  const contract = httpContractForSkill(row.skill)
  if (!contract) return false
  const endpoint = matchHttpEndpoint(
    contract,
    {
      method: "POST",
      host: COMPOSIO_EXECUTE_HOST,
      path: `/api/v3/tools/execute/${row.op}`,
    },
    { composioOverrides: composioOverridesForTemplate(row.template) },
  )
  return endpoint?.class === "READ" || endpoint?.class === "ACTION"
}

export function composioPrefixCoverage(): { skills: number; missingPrefix: string[] } {
  const composio = Object.values(SKILL_HTTP_CONTRACTS).filter((c) => c.auth === "composio")
  const missingPrefix = composio
    .filter((c) => !c.composioOpPrefix || !COMPOSIO_OP_PREFIX_BY_SKILL[c.skill])
    .map((c) => c.skill)
  return { skills: composio.length, missingPrefix }
}
