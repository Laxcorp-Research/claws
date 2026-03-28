import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get("cursor") || undefined
  const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!skill) return ERRORS.NOT_FOUND("skill")

  const reviews = await prisma.skillReview.findMany({
    where: { skillId: skill.id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = reviews.length > limit
  const items = reviews.slice(0, limit).map((r) => ({
    id: r.id,
    userName: r.user.name || "Anonymous",
    rating: r.rating,
    title: r.title,
    body: r.body,
    verifiedInstall: r.verifiedInstall,
    createdAt: r.createdAt.toISOString(),
  }))

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null

  return apiSuccess({ items, nextCursor })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!skill) return ERRORS.NOT_FOUND("skill")

  const install = await prisma.skillInstall.findUnique({
    where: { skillId_userId: { skillId: skill.id, userId: user.id } },
  })
  if (!install) {
    return apiError("INSTALL_REQUIRED", "You must install this skill before writing a review", 403)
  }

  const existing = await prisma.skillReview.findUnique({
    where: { skillId_userId: { skillId: skill.id, userId: user.id } },
  })
  if (existing) {
    return apiError("ALREADY_REVIEWED", "You have already reviewed this skill", 409)
  }

  const body = await request.json()
  const { rating, title, body: reviewBody } = body as {
    rating?: number
    title?: string
    body?: string
  }

  if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return ERRORS.VALIDATION("Rating must be an integer between 1 and 5")
  }
  if (title && title.length > 200) {
    return ERRORS.VALIDATION("Title must be 200 characters or less")
  }
  if (reviewBody && reviewBody.length > 2000) {
    return ERRORS.VALIDATION("Review body must be 2000 characters or less")
  }

  const review = await prisma.skillReview.create({
    data: {
      skillId: skill.id,
      userId: user.id,
      rating,
      title: title?.trim() || null,
      body: reviewBody?.trim() || null,
      verifiedInstall: true,
    },
  })

  const agg = await prisma.skillReview.aggregate({
    where: { skillId: skill.id },
    _avg: { rating: true },
  })
  await prisma.marketplaceSkill.update({
    where: { id: skill.id },
    data: { avgRating: agg._avg.rating },
  })

  return apiSuccess({ reviewId: review.id }, 201)
}
