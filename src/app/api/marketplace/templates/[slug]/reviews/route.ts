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

  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!template) return ERRORS.NOT_FOUND("template")

  const reviews = await prisma.templateReview.findMany({
    where: { clawTemplateId: template.id },
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

  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!template) return ERRORS.NOT_FOUND("template")

  const install = await prisma.templateInstall.findUnique({
    where: { templateId_userId: { templateId: template.id, userId: user.id } },
  })
  if (!install) {
    return apiError("INSTALL_REQUIRED", "You must install this template before writing a review", 403)
  }

  const existingReview = await prisma.templateReview.findUnique({
    where: { clawTemplateId_userId: { clawTemplateId: template.id, userId: user.id } },
  })
  if (existingReview) {
    return apiError("ALREADY_REVIEWED", "You have already reviewed this template", 409)
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

  const review = await prisma.templateReview.create({
    data: {
      clawTemplateId: template.id,
      userId: user.id,
      rating,
      title: title?.trim() || null,
      body: reviewBody?.trim() || null,
      verifiedInstall: true,
    },
  })

  const aggregation = await prisma.templateReview.aggregate({
    where: { clawTemplateId: template.id },
    _avg: { rating: true },
  })
  await prisma.clawTemplate.update({
    where: { id: template.id },
    data: { avgRating: aggregation._avg.rating },
  })

  return apiSuccess({ reviewId: review.id }, 201)
}
