import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import {
  canDeleteCreatorListing,
  deleteBlockedCopy,
} from "@/lib/marketplace/creator-listing-lifecycle"

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

  const templates = await prisma.clawTemplate.findMany({
    where: { creatorId: profile.id },
    select: {
      id: true,
      name: true,
      slug: true,
      isPublished: true,
      trustTier: true,
      reviewStatus: true,
      installCount: true,
      avgRating: true,
      price: true,
      isFree: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const templateIds = templates.map((t) => t.id)
  const sales = templateIds.length > 0
    ? await prisma.marketplaceSale.groupBy({
        by: ["templateId"],
        where: { templateId: { in: templateIds } },
        _sum: { creatorPayout: true },
        _count: true,
      })
    : []

  const salesMap = new Map(
    sales.map((s) => [s.templateId, {
      revenue: s._sum.creatorPayout ?? 0,
      salesCount: s._count,
    }])
  )

  const items = templates.map((t) => {
    const salesCount = salesMap.get(t.id)?.salesCount ?? 0
    const counts = { salesCount, installCount: t.installCount }
    const canDelete = canDeleteCreatorListing(counts)
    return {
      ...t,
      revenue: salesMap.get(t.id)?.revenue ?? 0,
      salesCount,
      canDelete,
      deleteBlockedReason: canDelete ? null : deleteBlockedCopy(counts),
      createdAt: t.createdAt.toISOString(),
    }
  })

  return apiSuccess({ templates: items })
}
