import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio, getComposioUserId } from "@/lib/composio"
import {
  ensureAuthConfigForToolkit,
  ComposioToolkitRequiresCustomOAuthError,
} from "@/lib/composio-auth-config"
import { getToolBySlug } from "@/data/tool-catalog"
import { log } from "@/lib/logger"

export const maxDuration = 30

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

  const composio = getComposio()
  if (!composio) {
    return apiError(
      "COMPOSIO_NOT_CONFIGURED",
      "OAuth connections are not configured. Set COMPOSIO_API_KEY or contact support.",
      503
    )
  }

  const body = (await req.json()) as { toolSlug?: string }
  const toolSlug = body.toolSlug
  if (!toolSlug) return ERRORS.VALIDATION("toolSlug is required")

  const def = getToolBySlug(toolSlug)
  const displayName = def?.name ?? toolSlug
  const toolkitSlug = def?.composioToolkitId ?? toolSlug

  try {
    const composioUserId = getComposioUserId(user.id)
    const authConfigId = await ensureAuthConfigForToolkit(composio, toolkitSlug)

    const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")
    const callbackUrl = `${base}/api/tools/${workspaceId}/oauth/callback?tool=${encodeURIComponent(toolSlug)}`

    const connectionRequest = await composio.connectedAccounts.initiate(composioUserId, authConfigId, {
      callbackUrl,
      allowMultiple: true,
    })

    if (!connectionRequest.redirectUrl) {
      return apiError(
        "COMPOSIO_NO_REDIRECT",
        "Composio did not return an OAuth URL for this toolkit. Check your Composio project settings.",
        502
      )
    }

    await prisma.toolConnection.upsert({
      where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
      create: {
        workspaceId,
        toolSlug,
        displayName,
        connectionType: "OAUTH_COMPOSIO",
        composioConnectionId: connectionRequest.id,
        composioEntityId: composioUserId,
        status: "PENDING",
      },
      update: {
        displayName,
        composioConnectionId: connectionRequest.id,
        composioEntityId: composioUserId,
        status: "PENDING",
      },
    })

    return apiSuccess({
      redirectUrl: connectionRequest.redirectUrl,
      connectionId: connectionRequest.id,
    })
  } catch (err) {
    if (err instanceof ComposioToolkitRequiresCustomOAuthError) {
      // 422 Unprocessable: the request shape is fine but the targeted
      // toolkit isn't configured for managed-auth in our Composio project.
      // The wizard renders a yellow "Setup in progress" warning on this
      // code (see src/app/setup/[workspaceId]/step/[n]/page.tsx + the
      // useOAuthConnection hook). Operator action tracked in
      // docs/COMPOSIO_RUNTIME_CONTRACT.md "Custom OAuth toolkits".
      return apiError(
        "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH",
        "This integration requires custom setup. Available within a few days.",
        422
      )
    }
    const message = err instanceof Error ? err.message : "Failed to initiate OAuth connection"
    log.error("Composio OAuth initiate failed", { toolSlug, workspaceId, error: message })
    return apiError("COMPOSIO_INITIATE_FAILED", message, 500)
  }
}
