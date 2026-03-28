import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { Prisma, TrustTier, ClawCategory } from "@/generated/prisma/client"

interface SnapshotAgent {
  name: string
  role: string
  color: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const category = searchParams.get("category") || undefined
    const trustTier = searchParams.get("trustTier") || undefined
    const isFree = searchParams.get("isFree")
    const search = searchParams.get("search") || undefined
    const sort = searchParams.get("sort") || "popular"
    const cursor = searchParams.get("cursor") || undefined
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50)
    const section = searchParams.get("section") || undefined

    const where: Prisma.ClawTemplateWhereInput = {
      isPublished: true,
    }

    if (category) {
      where.category = category as ClawCategory
    }

    if (trustTier) {
      const tierHierarchy: Record<string, string[]> = {
        OFFICIAL: ["OFFICIAL"],
        VERIFIED: ["VERIFIED", "OFFICIAL"],
        SCANNED: ["SCANNED", "VERIFIED", "OFFICIAL"],
        UNREVIEWED: ["UNREVIEWED", "SCANNED", "VERIFIED", "OFFICIAL"],
      }
      const tiers = tierHierarchy[trustTier] ?? ["OFFICIAL"]
      where.trustTier = { in: tiers as TrustTier[] }
    }

    if (section === "official") {
      where.trustTier = "OFFICIAL"
    }

    if (isFree === "true") {
      where.isFree = true
    } else if (isFree === "false") {
      where.isFree = false
      where.price = { gt: 0 }
    }

    if (search && search.trim().length > 0) {
      const q = search.trim()
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tagline: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ]
    }

    if (section === "trending") {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      where.trustTier = { not: "OFFICIAL" }
      where.installs = { some: { createdAt: { gte: sevenDaysAgo } } }

      const trending = await prisma.clawTemplate.findMany({
        where,
        include: {
          creator: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
          _count: {
            select: {
              installs: { where: { createdAt: { gte: sevenDaysAgo } } },
            },
          },
        },
        take: 50,
      })

      const sorted = trending
        .sort((a, b) => (b._count.installs) - (a._count.installs))
        .slice(0, limit)

      const items = sorted.map(({ _count, ...t }) => ({
        ...formatTemplate(t),
        recentInstalls: _count.installs,
      }))

      return apiSuccess({ items, nextCursor: null, totalCount: items.length })
    }

    const orderBy: Prisma.ClawTemplateOrderByWithRelationInput = (() => {
      switch (sort) {
        case "newest": return { createdAt: "desc" as const }
        case "price_asc": return { price: "asc" as const }
        case "price_desc": return { price: "desc" as const }
        case "rating": return { avgRating: "desc" as const }
        case "popular":
        default: return { installCount: "desc" as const }
      }
    })()

    const templates = await prisma.clawTemplate.findMany({
      where,
      include: {
        creator: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = templates.length > limit
    const items = templates.slice(0, limit).map((t) => formatTemplate(t))
    const nextCursor = hasMore && templates.length > limit
      ? templates[limit - 1].id
      : null

    const totalCount = cursor
      ? -1
      : await prisma.clawTemplate.count({ where })

    return apiSuccess({ items, nextCursor, totalCount })
  } catch (error) {
    console.error("Marketplace templates error:", error)
    return apiError("MARKETPLACE_ERROR", "Failed to fetch templates", 500)
  }
}

function formatTemplate(t: {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: string
  price: number
  isFree: boolean
  trustTier: string
  installCount: number
  avgRating: number | null
  estimatedMonthlyCost: string | null
  workspaceSnapshot: string
  creator: { id: string; displayName: string; avatarUrl: string | null } | null
}) {
  let agents: SnapshotAgent[] = []
  let flowDescription = ""
  let legalDisclaimer: string | null = null
  try {
    const snap = JSON.parse(t.workspaceSnapshot)
    agents = (snap.agents ?? []).map((a: SnapshotAgent) => ({
      name: a.name,
      role: a.role,
      color: a.color,
    }))
    flowDescription = snap.flowDescription ?? ""
    legalDisclaimer = snap.legalDisclaimer ?? null
  } catch { /* malformed snapshot */ }

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    tagline: t.tagline,
    description: t.description,
    category: t.category,
    price: t.price,
    isFree: t.isFree,
    trustTier: t.trustTier,
    installCount: t.installCount,
    avgRating: t.avgRating,
    estimatedMonthlyCost: t.estimatedMonthlyCost,
    creator: t.creator,
    agents,
    flowDescription,
    legalDisclaimer,
  }
}
