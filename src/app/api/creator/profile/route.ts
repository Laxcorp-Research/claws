import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
  })

  if (!profile) {
    return apiSuccess({ enrolled: false, profile: null })
  }

  return apiSuccess({ enrolled: true, profile })
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const existing = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
  })
  if (!existing) {
    return apiError("NOT_ENROLLED", "You are not enrolled as a creator", 403)
  }

  const body = await request.json()
  const { displayName, bio, avatarUrl, twitterUrl, githubUrl, websiteUrl } = body as {
    displayName?: string
    bio?: string | null
    avatarUrl?: string | null
    twitterUrl?: string | null
    githubUrl?: string | null
    websiteUrl?: string | null
  }

  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.trim().length < 2) {
      return ERRORS.VALIDATION("Display name must be at least 2 characters")
    }
    if (displayName.trim().length > 50) {
      return ERRORS.VALIDATION("Display name must be 50 characters or less")
    }
  }
  if (bio !== undefined && bio !== null && bio.length > 500) {
    return ERRORS.VALIDATION("Bio must be 500 characters or less")
  }

  const isValidUrl = (url: string) => {
    try { new URL(url); return true } catch { return false }
  }

  if (avatarUrl && !isValidUrl(avatarUrl)) return ERRORS.VALIDATION("Invalid avatar URL")
  if (twitterUrl && !isValidUrl(twitterUrl)) return ERRORS.VALIDATION("Invalid Twitter URL")
  if (githubUrl && !isValidUrl(githubUrl)) return ERRORS.VALIDATION("Invalid GitHub URL")
  if (websiteUrl && !isValidUrl(websiteUrl)) return ERRORS.VALIDATION("Invalid website URL")

  const updateData: Record<string, unknown> = {}
  if (displayName !== undefined) updateData.displayName = displayName.trim()
  if (bio !== undefined) updateData.bio = bio?.trim() || null
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl?.trim() || null
  if (twitterUrl !== undefined) updateData.twitterUrl = twitterUrl?.trim() || null
  if (githubUrl !== undefined) updateData.githubUrl = githubUrl?.trim() || null
  if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl?.trim() || null

  const updated = await prisma.creatorProfile.update({
    where: { userId: user.id },
    data: updateData,
  })

  return apiSuccess({ profile: updated })
}
