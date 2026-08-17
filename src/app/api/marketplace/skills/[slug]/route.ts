import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import {
  isPubliclyListable,
  ownerMaySeePendingReview,
  pendingReviewListing,
} from "@/lib/marketplace/public-visibility"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
    include: {
      creator: {
        select: {
          id: true,
          userId: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          totalTemplates: true,
          totalInstalls: true,
          averageRating: true,
        },
      },
      reviews: {
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true } },
        },
      },
      _count: {
        select: { reviews: true, installs: true },
      },
    },
  })

  if (!skill) return ERRORS.NOT_FOUND("skill")
  if (!isPubliclyListable(skill)) {
    let viewerUserId: string | null = null
    let creatorUserId: string | null = null
    try {
      const user = await getSessionUser()
      viewerUserId = user?.id ?? null
    } catch {
      viewerUserId = null
    }
    if (skill.creatorId && viewerUserId) {
      const owner = await prisma.creatorProfile.findUnique({
        where: { id: skill.creatorId },
        select: { userId: true },
      })
      creatorUserId = owner?.userId ?? null
    }
    if (
      ownerMaySeePendingReview({
        publiclyListable: false,
        reviewStatus: skill.reviewStatus,
        viewerUserId,
        creatorUserId,
      })
    ) {
      return apiSuccess(pendingReviewListing(skill.name, skill.slug))
    }
    return ERRORS.NOT_FOUND("skill")
  }

  const formattedReviews = skill.reviews.map((r) => ({
    id: r.id,
    userName: r.user.name || "Anonymous",
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedInstall: r.verifiedInstall,
    createdAt: r.createdAt.toISOString(),
  }))

  let installStatus: {
    installed: boolean
    hasPurchased: boolean
    hasRunningWorkspaces: boolean
    workspaces: Array<{
      id: string
      name: string
      agents: Array<{ id: string; name: string; role: string }>
    }>
  } | null = null
  let isOwner = false

  try {
    const user = await getSessionUser()
    if (user) {
      isOwner = user.id === skill.creator?.userId
      const existingInstall = await prisma.skillInstall.findUnique({
        where: { skillId_userId: { skillId: skill.id, userId: user.id } },
      })

      // Entitlement = MarketplaceSale row (buyerId + skillId).
      const purchase = await prisma.marketplaceSale.findFirst({
        where: { skillId: skill.id, buyerId: user.id },
        select: { id: true },
      })

      // REDEPLOY-CARRIES: any owned workspace can receive AgentSkill attach.
      const workspaces = await prisma.workspace.findMany({
        where: { userId: user.id, status: { not: "DRAFT" } },
        select: {
          id: true,
          name: true,
          status: true,
          agents: {
            select: { id: true, name: true, role: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      })

      installStatus = {
        installed: !!existingInstall,
        hasPurchased: !!purchase,
        hasRunningWorkspaces: workspaces.some((w) => w.status === "RUNNING"),
        workspaces: workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          agents: w.agents,
        })),
      }
    }
  } catch {
    installStatus = null
    isOwner = false
  }

  const creator = skill.creator
    ? {
        id: skill.creator.id,
        displayName: skill.creator.displayName,
        avatarUrl: skill.creator.avatarUrl,
        bio: skill.creator.bio,
        totalTemplates: skill.creator.totalTemplates,
        totalInstalls: skill.creator.totalInstalls,
        averageRating: skill.creator.averageRating,
      }
    : null

  return apiSuccess({
    skill: {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      emoji: skill.emoji,
      description: skill.description,
      category: skill.category,
      trustTier: skill.trustTier,
      isFree: skill.isFree,
      price: skill.price,
      installCount: skill._count.installs,
      avgRating: skill.avgRating,
      skillMd: skill.skillMd,
      requiredBins: skill.requiredBins,
      requiredEnvVars: skill.requiredEnvVars,
      minOpenClawVersion: skill.minOpenClawVersion,
      creator,
      publishedAt: skill.publishedAt?.toISOString() ?? null,
    },
    reviews: formattedReviews,
    reviewCount: skill._count.reviews,
    installStatus,
    isOwner,
  })
}
