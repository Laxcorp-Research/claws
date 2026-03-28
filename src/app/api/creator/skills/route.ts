import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!profile) {
    return apiError("NOT_ENROLLED", "Not enrolled as creator", 403)
  }

  const skills = await prisma.marketplaceSkill.findMany({
    where: { creatorId: profile.id },
    select: {
      id: true,
      name: true,
      slug: true,
      emoji: true,
      isPublished: true,
      trustTier: true,
      reviewStatus: true,
      installCount: true,
      avgRating: true,
      price: true,
      isFree: true,
      createdAt: true,
      publishedAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const skillIds = skills.map((s) => s.id)
  const sales = skillIds.length > 0
    ? await prisma.marketplaceSale.groupBy({
        by: ["skillId"],
        where: { skillId: { in: skillIds } },
        _sum: { creatorPayout: true },
        _count: true,
      })
    : []

  const salesMap = new Map(
    sales.map((s) => [s.skillId, {
      revenue: s._sum.creatorPayout ?? 0,
      salesCount: s._count,
    }])
  )

  const items = skills.map((s) => ({
    ...s,
    revenue: salesMap.get(s.id)?.revenue ?? 0,
    salesCount: salesMap.get(s.id)?.salesCount ?? 0,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  }))

  return apiSuccess({ skills: items })
}
