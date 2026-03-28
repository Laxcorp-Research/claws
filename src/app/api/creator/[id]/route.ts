import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const profile = await prisma.creatorProfile.findUnique({
    where: { id },
  })
  if (!profile || !profile.isActive) return ERRORS.NOT_FOUND("creator")

  const templates = await prisma.clawTemplate.findMany({
    where: { creatorId: id, isPublished: true },
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      price: true,
      isFree: true,
      category: true,
      trustTier: true,
      installCount: true,
      avgRating: true,
    },
    orderBy: { installCount: "desc" },
  })

  const skills = await prisma.marketplaceSkill.findMany({
    where: { creatorId: id, isPublished: true },
    select: {
      id: true,
      slug: true,
      name: true,
      emoji: true,
      description: true,
      category: true,
      trustTier: true,
      installCount: true,
      isFree: true,
      price: true,
      avgRating: true,
    },
    orderBy: { installCount: "desc" },
  })

  return apiSuccess({
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      twitterUrl: profile.twitterUrl,
      githubUrl: profile.githubUrl,
      websiteUrl: profile.websiteUrl,
      totalTemplates: profile.totalTemplates,
      totalSkills: profile.totalSkills,
      totalInstalls: profile.totalInstalls,
      averageRating: profile.averageRating,
      isActive: profile.isActive,
    },
    templates,
    skills,
  })
}
