import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getComposio } from "@/lib/composio"
import { log } from "@/lib/logger"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = (await req.json()) as { toolSlug?: string }
  const toolSlug = body.toolSlug
  if (!toolSlug) return ERRORS.VALIDATION("toolSlug is required")

  const toolConnection = await prisma.toolConnection.findUnique({
    where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
  })

  if (!toolConnection) return ERRORS.NOT_FOUND("Tool connection")

  if (toolConnection.composioConnectionId) {
    const composio = getComposio()
    if (composio) {
      try {
        await composio.connectedAccounts.delete(toolConnection.composioConnectionId)
      } catch {
        // continue with local delete
      }
    }
  }

  await prisma.toolConnection.delete({
    where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
  })

  log.toolEvent({
    event: "disconnected",
    toolSlug,
    connectionType: "OAUTH_COMPOSIO",
    workspaceId,
    userId: user.id,
  })

  return apiSuccess({ disconnected: true })
}
