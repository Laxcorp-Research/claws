/**
 * Bridge MarketplaceSkill → Skill (library row) for install / builder.
 * Copies bins/env/emoji so the generator can emit SKILL.md + skills.entries.
 */
import { prisma } from "@/lib/db"
import type { Skill, SkillCategory } from "@/generated/prisma/client"

const CATEGORY_MAP: Record<string, SkillCategory> = {
  core: "CORE",
  crm: "CRM",
  email: "EMAIL_SENDER",
  social: "SOCIAL",
  calendar: "CALENDAR",
  analytics: "ANALYTICS",
  search: "SEARCH",
  finance: "FINANCE",
  trading: "TRADING",
  content: "CONTENT",
  communication: "COMMUNICATION",
  security: "SECURITY",
  marketing: "CRM",
  developer: "CORE",
  productivity: "CORE",
  system: "CORE",
  data: "ANALYTICS",
  web: "SEARCH",
  utilities: "CORE",
}

export function mapMarketplaceCategory(raw: string): SkillCategory {
  const lower = raw.toLowerCase().trim()
  return CATEGORY_MAP[lower] || "CUSTOM"
}

export type MarketplaceSkillBridgeSource = {
  id: string
  slug: string
  name: string
  description: string
  category: string
  skillMd: string
  emoji: string | null
  requiredBins: string[]
  requiredEnvVars: string[]
  trustTier: string
}

/** Upsert Skill from a marketplace listing. Syncs metadata on every call. */
export async function bridgeMarketplaceSkillToSkill(
  mpSkill: MarketplaceSkillBridgeSource,
): Promise<Skill> {
  const data = {
    name: mpSkill.name,
    description: mpSkill.description || "Marketplace skill",
    skillMd: mpSkill.skillMd || "",
    type: "USER_GENERATED" as const,
    category: mapMarketplaceCategory(mpSkill.category),
    emoji: mpSkill.emoji,
    requiredBins: mpSkill.requiredBins ?? [],
    requiredEnvVars: mpSkill.requiredEnvVars ?? [],
    isVerified: mpSkill.trustTier === "VERIFIED" || mpSkill.trustTier === "OFFICIAL",
    isBuiltIn: false,
    isCurated: false,
  }

  const existing = await prisma.skill.findUnique({ where: { slug: mpSkill.slug } })
  if (existing) {
    return prisma.skill.update({
      where: { id: existing.id },
      data,
    })
  }

  return prisma.skill.create({
    data: {
      slug: mpSkill.slug,
      ...data,
    },
  })
}
