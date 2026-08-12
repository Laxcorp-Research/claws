import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS, apiError } from "@/lib/api/response"
import { isPubliclyListable } from "@/lib/marketplace/public-visibility"
import { bridgeMarketplaceSkillToSkill } from "@/lib/marketplace/skill-bridge"

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
    if (!isPubliclyListable(mpSkill)) return ERRORS.NOT_FOUND("Marketplace skill")

    const skill = await bridgeMarketplaceSkillToSkill(mpSkill)

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
