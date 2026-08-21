import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { deleteTemplate } from "@/lib/marketplace/creator-listing-actions"
import {
  ownerMaySeeUnpublished,
  unpublishedListing,
} from "@/lib/marketplace/creator-listing-lifecycle"
import { listingActionResponse } from "@/lib/marketplace/listing-action-response"
import {
  isPubliclyListable,
  ownerMaySeePendingReview,
  pendingReviewListing,
  publicListingWhere,
} from "@/lib/marketplace/public-visibility"

interface SnapshotAgent {
  id?: string
  name: string
  agentSlug?: string
  role: string
  color: string
}

interface SnapshotConnection {
  sourceSlug?: string
  targetSlug?: string
  sourceAgentId?: string
  targetAgentId?: string
}

interface SnapshotTool {
  slug: string
  name: string
  category: string
  connectionType: string
  required: boolean
  alternatives?: string[]
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const template = await prisma.clawTemplate.findUnique({
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

  if (!template) return ERRORS.NOT_FOUND("template")
  if (!isPubliclyListable(template)) {
    let viewerUserId: string | null = null
    let creatorUserId: string | null = null
    try {
      const user = await getSessionUser()
      viewerUserId = user?.id ?? null
    } catch {
      viewerUserId = null
    }
    if (template.creatorId && viewerUserId) {
      const owner = await prisma.creatorProfile.findUnique({
        where: { id: template.creatorId },
        select: { userId: true },
      })
      creatorUserId = owner?.userId ?? null
    }
    if (
      ownerMaySeePendingReview({
        publiclyListable: false,
        reviewStatus: template.reviewStatus,
        viewerUserId,
        creatorUserId,
      })
    ) {
      return apiSuccess(pendingReviewListing(template.name, template.slug))
    }
    if (
      ownerMaySeeUnpublished({
        publiclyListable: false,
        reviewStatus: template.reviewStatus,
        viewerUserId,
        creatorUserId,
      })
    ) {
      return apiSuccess(unpublishedListing(template.name, template.slug))
    }
    return ERRORS.NOT_FOUND("template")
  }

  let agents: SnapshotAgent[] = []
  let tools: { required: SnapshotTool[]; recommended: SnapshotTool[] } = { required: [], recommended: [] }
  let flowDescription = ""
  let legalDisclaimer: string | null = null
  let workspaceSnapshot: { agents: SnapshotAgent[]; connections: SnapshotConnection[] } | null = null
  try {
    const snap = JSON.parse(template.workspaceSnapshot) as {
      agents?: SnapshotAgent[]
      connections?: SnapshotConnection[]
      tools?: SnapshotTool[]
      flowDescription?: string
      legalDisclaimer?: string | null
    }
    agents = (snap.agents ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      agentSlug: a.agentSlug,
      role: a.role,
      color: a.color,
    }))
    const connections = (snap.connections ?? []).map((c) => ({
      sourceSlug: c.sourceSlug,
      targetSlug: c.targetSlug,
      sourceAgentId: c.sourceAgentId,
      targetAgentId: c.targetAgentId,
    }))
    workspaceSnapshot = { agents, connections }
    const allTools = (snap.tools ?? []) as SnapshotTool[]
    tools = {
      required: allTools.filter((t) => t.required),
      recommended: allTools.filter((t) => !t.required),
    }
    flowDescription = snap.flowDescription ?? ""
    legalDisclaimer = snap.legalDisclaimer ?? null
  } catch { /* malformed snapshot */ }

  const formattedReviews = template.reviews.map((r) => ({
    id: r.id,
    userName: r.user.name || "Anonymous",
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedInstall: r.verifiedInstall,
    createdAt: r.createdAt.toISOString(),
  }))

  const currentPrice = template.price ?? 0
  const priceTierWhere = currentPrice === 0
    ? { isFree: true }
    : currentPrice < 150
      ? { price: { gt: 0, lt: 150 } }
      : { price: { gte: 150 } }

  let similar = await prisma.clawTemplate.findMany({
    where: {
      ...publicListingWhere(),
      category: template.category,
      id: { not: template.id },
      ...priceTierWhere,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      price: true,
      category: true,
      trustTier: true,
      installCount: true,
      avgRating: true,
    },
    orderBy: { installCount: "desc" },
    take: 3,
  })

  if (similar.length < 3) {
    const existingIds = [template.id, ...similar.map((s) => s.id)]
    const backfill = await prisma.clawTemplate.findMany({
      where: {
        ...publicListingWhere(),
        category: template.category,
        id: { notIn: existingIds },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        tagline: true,
        price: true,
        category: true,
        trustTier: true,
        installCount: true,
        avgRating: true,
      },
      orderBy: { installCount: "desc" },
      take: 3 - similar.length,
    })
    similar = [...similar, ...backfill]
  }

  let hasPurchased = false
  let isOwner = false

  try {
    const user = await getSessionUser()
    if (user) {
      isOwner = user.id === template.creator?.userId
      const purchase = await prisma.purchase.findFirst({
        where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
        select: { id: true },
      })
      hasPurchased = !!purchase
    }
  } catch {
    hasPurchased = false
    isOwner = false
  }

  const creator = template.creator
    ? {
        id: template.creator.id,
        displayName: template.creator.displayName,
        avatarUrl: template.creator.avatarUrl,
        bio: template.creator.bio,
        totalTemplates: template.creator.totalTemplates,
        totalInstalls: template.creator.totalInstalls,
        averageRating: template.creator.averageRating,
      }
    : null

  return apiSuccess({
    template: {
      id: template.id,
      name: template.name,
      slug: template.slug,
      tagline: template.tagline,
      description: template.description,
      category: template.category,
      price: template.price,
      isFree: template.isFree,
      trustTier: template.trustTier,
      installCount: template.installCount,
      avgRating: template.avgRating,
      estimatedMonthlyCost: template.estimatedMonthlyCost,
      agentCount: template.agentCount,
      version: template.version,
      creatorId: template.creatorId,
      creator,
      agents,
      tools,
      flowDescription,
      legalDisclaimer,
      workspaceSnapshot,
    },
    reviews: formattedReviews,
    reviewCount: template._count.reviews,
    installCount: template.installCount,
    similar,
    hasPurchased,
    isOwner,
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { slug } = await params
  return listingActionResponse(await deleteTemplate(user.id, slug))
}

