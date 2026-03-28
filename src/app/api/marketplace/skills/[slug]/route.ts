import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

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
    hasRunningWorkspaces: boolean
    workspaces: Array<{ id: string; name: string }>
  } | null = null

  try {
    const user = await getSessionUser()
    if (user) {
      const existingInstall = await prisma.skillInstall.findUnique({
        where: { skillId_userId: { skillId: skill.id, userId: user.id } },
      })

      const runningWorkspaces = await prisma.workspace.findMany({
        where: { userId: user.id, status: "RUNNING" },
        select: { id: true, name: true },
      })

      installStatus = {
        installed: !!existingInstall,
        hasRunningWorkspaces: runningWorkspaces.length > 0,
        workspaces: runningWorkspaces,
      }
    }
  } catch {
    installStatus = null
  }

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
      creator: skill.creator,
      publishedAt: skill.publishedAt?.toISOString() ?? null,
    },
    reviews: formattedReviews,
    reviewCount: skill._count.reviews,
    installStatus,
  })
}
