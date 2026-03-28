import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const existing = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
  })
  if (existing) {
    return apiError("ALREADY_ENROLLED", "You are already enrolled as a creator", 409)
  }

  const body = await request.json()
  const { displayName, bio, avatarUrl, twitterUrl, githubUrl, websiteUrl } = body as {
    displayName?: string
    bio?: string
    avatarUrl?: string
    twitterUrl?: string
    githubUrl?: string
    websiteUrl?: string
  }

  if (!displayName || displayName.trim().length < 2) {
    return ERRORS.VALIDATION("Display name is required (minimum 2 characters)")
  }
  if (displayName.trim().length > 50) {
    return ERRORS.VALIDATION("Display name must be 50 characters or less")
  }
  if (bio && bio.length > 500) {
    return ERRORS.VALIDATION("Bio must be 500 characters or less")
  }

  const isValidUrl = (url: string) => {
    try { new URL(url); return true } catch { return false }
  }

  if (avatarUrl && !isValidUrl(avatarUrl)) return ERRORS.VALIDATION("Invalid avatar URL")
  if (twitterUrl && !isValidUrl(twitterUrl)) return ERRORS.VALIDATION("Invalid Twitter URL")
  if (githubUrl && !isValidUrl(githubUrl)) return ERRORS.VALIDATION("Invalid GitHub URL")
  if (websiteUrl && !isValidUrl(websiteUrl)) return ERRORS.VALIDATION("Invalid website URL")

  const profile = await prisma.creatorProfile.create({
    data: {
      userId: user.id,
      displayName: displayName.trim(),
      bio: bio?.trim() || null,
      avatarUrl: avatarUrl?.trim() || null,
      twitterUrl: twitterUrl?.trim() || null,
      githubUrl: githubUrl?.trim() || null,
      websiteUrl: websiteUrl?.trim() || null,
      agreedToTermsAt: new Date(),
      totalTemplates: 0,
      totalInstalls: 0,
      totalSkills: 0,
      averageRating: 0,
    },
  })

  return apiSuccess({ profileId: profile.id }, 201)
}
