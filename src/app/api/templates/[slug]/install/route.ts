import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { isSelfHost } from "@/lib/profile"
import { isPubliclyListable } from "@/lib/marketplace/public-visibility"
import { createWorkspaceFromTemplate } from "@/lib/workspace-from-template"

/**
 * Self-host install. Same workspace writer as the hosted payment webhook.
 * No checkout, no trial stamp, no Purchase row.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isSelfHost()) {
    return apiError(
      "HOSTED_ONLY",
      "Template install without checkout is only available when CLAWS_PROFILE=self-host",
      404,
    )
  }

  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()

  const { slug } = await params
  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    select: {
      id: true,
      isPublished: true,
      trustTier: true,
      reviewStatus: true,
    },
  })
  if (!template || !isPubliclyListable(template)) return ERRORS.NOT_FOUND("Template")

  const { workspaceId } = await createWorkspaceFromTemplate({
    userId: sessionUser.id,
    templateId: template.id,
  })

  return apiSuccess({ redirectUrl: `/setup/${workspaceId}/step/1` })
}
