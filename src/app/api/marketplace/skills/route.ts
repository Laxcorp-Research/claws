import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { Prisma, TrustTier } from "@/generated/prisma/client"

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

    const where: Prisma.MarketplaceSkillWhereInput = {
      isPublished: true,
    }

    if (category) {
      where.category = category
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

    if (isFree === "true") {
      where.isFree = true
    } else if (isFree === "false") {
      where.isFree = false
    }

    if (search && search.trim().length > 0) {
      const q = search.trim()
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ]
    }

    const orderBy: Prisma.MarketplaceSkillOrderByWithRelationInput = (() => {
      switch (sort) {
        case "newest": return { publishedAt: "desc" as const }
        case "price_asc": return { price: "asc" as const }
        case "price_desc": return { price: "desc" as const }
        case "rating": return { avgRating: "desc" as const }
        case "popular":
        default: return { installCount: "desc" as const }
      }
    })()

    const skills = await prisma.marketplaceSkill.findMany({
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

    const hasMore = skills.length > limit
    const items = skills.slice(0, limit).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      emoji: s.emoji,
      description: s.description,
      category: s.category,
      trustTier: s.trustTier,
      installCount: s.installCount,
      avgRating: s.avgRating,
      isFree: s.isFree,
      price: s.price,
      creator: s.creator,
    }))

    const nextCursor = hasMore && skills.length > limit
      ? skills[limit - 1].id
      : null

    const totalCount = cursor
      ? -1
      : await prisma.marketplaceSkill.count({ where })

    return apiSuccess({ items, nextCursor, totalCount })
  } catch (error) {
    console.error("Marketplace skills error:", error)
    return apiError("MARKETPLACE_ERROR", "Failed to fetch skills", 500)
  }
}
