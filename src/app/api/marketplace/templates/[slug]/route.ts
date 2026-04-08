import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

interface SnapshotAgent {
  name: string
  role: string
  color: string
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

  let agents: SnapshotAgent[] = []
  let tools: { required: SnapshotTool[]; recommended: SnapshotTool[] } = { required: [], recommended: [] }
  let flowDescription = ""
  let legalDisclaimer: string | null = null
  try {
    const snap = JSON.parse(template.workspaceSnapshot)
    agents = (snap.agents ?? []).map((a: SnapshotAgent) => ({
      name: a.name,
      role: a.role,
      color: a.color,
    }))
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
      category: template.category,
      id: { not: template.id },
      isPublished: true,
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
        category: template.category,
        id: { notIn: existingIds },
        isPublished: true,
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

  try {
    const user = await getSessionUser()
    if (user) {
      const purchase = await prisma.purchase.findFirst({
        where: { userId: user.id, clawTemplateId: template.id, status: "COMPLETED" },
        select: { id: true },
      })
      hasPurchased = !!purchase
    }
  } catch {
    hasPurchased = false
  }

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
      installCount: template._count.installs,
      avgRating: template.avgRating,
      estimatedMonthlyCost: template.estimatedMonthlyCost,
      agentCount: template.agentCount,
      version: template.version,
      creatorId: template.creatorId,
      creator: template.creator,
      agents,
      tools,
      flowDescription,
      legalDisclaimer,
    },
    reviews: formattedReviews,
    reviewCount: template._count.reviews,
    installCount: template._count.installs,
    similar,
    hasPurchased,
  })
}
