import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio } from "@/lib/composio"
import { log } from "@/lib/logger"

type PollStatus = "PENDING" | "ACTIVE" | "FAILED"

function mapComposioStatus(raw: string): PollStatus {
  if (raw === "ACTIVE") return "ACTIVE"
  if (raw === "FAILED" || raw === "EXPIRED") return "FAILED"
  return "PENDING"
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const url = new URL(request.url)
  const connectionId = url.searchParams.get("connectionId")
  const toolSlug = url.searchParams.get("toolSlug")
  if (!connectionId || !toolSlug) {
    return ERRORS.VALIDATION("connectionId and toolSlug are required")
  }

  const composio = getComposio()
  if (!composio) {
    return apiError("COMPOSIO_NOT_CONFIGURED", "OAuth is not configured.", 503)
  }

  try {
    const account = await composio.connectedAccounts.get(connectionId)
    const rawStatus = account.status
    const status = mapComposioStatus(rawStatus)

    if (status === "ACTIVE") {
      await prisma.toolConnection.update({
        where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
        data: {
          status: "CONNECTED",
          composioConnectionId: connectionId,
        },
      })

      log.toolEvent({
        event: "connected",
        toolSlug,
        connectionType: "OAUTH_COMPOSIO",
        workspaceId,
        userId: user.id,
      })
    }

    if (status === "FAILED") {
      await prisma.toolConnection.updateMany({
        where: { workspaceId, toolSlug, composioConnectionId: connectionId },
        data: { status: "ERROR", lastError: `Composio status: ${rawStatus}` },
      })
    }

    return apiSuccess({ status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn("Composio status check failed", { connectionId, error: message })
    return apiSuccess({ status: "PENDING" as const })
  }
}
