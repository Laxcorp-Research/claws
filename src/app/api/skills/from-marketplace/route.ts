import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS, apiError } from "@/lib/api/response"
import type { SkillCategory } from "@/generated/prisma/client"

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
}

function mapCategory(raw: string): SkillCategory {
  const lower = raw.toLowerCase().trim()
  return CATEGORY_MAP[lower] || "CUSTOM"
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { marketplaceSkillId } = body as { marketplaceSkillId?: string }

  if (!marketplaceSkillId) {
    return ERRORS.VALIDATION("marketplaceSkillId is required")
  }

  try {
    const mpSkill = await prisma.marketplaceSkill.findUnique({
      where: { id: marketplaceSkillId },
    })
    if (!mpSkill) return ERRORS.NOT_FOUND("Marketplace skill")

    let skill = await prisma.skill.findUnique({ where: { slug: mpSkill.slug } })

    if (!skill) {
      skill = await prisma.skill.create({
        data: {
          name: mpSkill.name,
          slug: mpSkill.slug,
          description: mpSkill.description || "Marketplace skill",
          skillMd: mpSkill.skillMd || "",
          type: "USER_GENERATED",
          category: mapCategory(mpSkill.category),
          isVerified: mpSkill.trustTier === "VERIFIED" || mpSkill.trustTier === "OFFICIAL",
          isBuiltIn: false,
          isCurated: false,
        },
      })
    }

    return apiSuccess({
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      category: skill.category,
      description: skill.description,
    })
  } catch (error) {
    console.error("Failed to bridge marketplace skill:", error)
    return apiError("INTERNAL_ERROR", "Failed to process skill", 500)
  }
}
