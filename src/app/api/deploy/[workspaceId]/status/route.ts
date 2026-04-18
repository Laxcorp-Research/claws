import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getApiKeySource } from "@/lib/credits/api-key-source"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const owner = await prisma.user.findUnique({
    where: { id: user.id },
    select: { apiKeySource: true },
  })
  const apiKeySource = getApiKeySource(workspace!, owner)

  const deployment = await prisma.deployment.findFirst({
    where: { workspaceId },
    orderBy: { startedAt: "desc" },
  })

  if (!deployment) return apiSuccess({ deployment: null, apiKeySource })

  return apiSuccess({
    deployment: {
      id: deployment.id,
      status: deployment.status,
      version: deployment.version,
      errorMessage: deployment.errorMessage,
      startedAt: deployment.startedAt,
      completedAt: deployment.completedAt,
      containerId: deployment.containerId,
      containerImage: deployment.containerImage,
    },
    apiKeySource,
  })
}
