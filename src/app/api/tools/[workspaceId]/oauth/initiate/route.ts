import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio, getComposioUserId } from "@/lib/composio"
import {
  ensureAuthConfigForToolkit,
  fetchToolkitWithAuthMode,
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
    // PR2.9: Three-way auth-mode branch.
    //
    //   managed-oauth        → existing path (popup + poll)
    //   byok-api-key         → return apiKeyForm; client opens CredentialsModal
    //                          and submits the user's key to
    //                          /api/tools/[wsId]/byok/submit
    //   requires-custom-oauth → 422 (operator must register OAuth app in
    //                          Composio dashboard before this toolkit
    //                          can be used)
    //
    // Single `toolkits.get` call shared by both detection and the
    // managed-OAuth path's downstream helper — saves one round-trip when
    // managed is the chosen path.
    const { mode } = await fetchToolkitWithAuthMode(composio, toolkitSlug)

    if (mode === "requires-custom-oauth") {
      throw new ComposioToolkitRequiresCustomOAuthError(toolkitSlug)
    }

    if (mode === "byok-api-key") {
      // The user supplies their own API key for this toolkit. No popup,
      // no poll — the wizard renders an inline credentials form and POSTs
      // the key to /api/tools/[wsId]/byok/submit, which synchronously
      // creates the Composio connected account and marks the
      // ToolConnection row CONNECTED.
      //
      // Field shape: prefer catalog-declared `credentialFields` when
      // present (so we can name the env var deterministically — e.g.
      // TYPEFULLY_API_KEY for runtime env injection); else synthesize a
      // single-field default (UPPER_SNAKE_<SLUG>_API_KEY).
      const fields =
        def?.credentialFields && def.credentialFields.length > 0
          ? def.credentialFields
          : [
              {
                envVar: `${toolSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`,
                label: "API Key",
                required: true,
                primary: true,
                ...(def?.helpUrl ? { helpUrl: def.helpUrl } : {}),
              },
            ]

      return apiSuccess({
        mode: "byok",
        apiKeyForm: {
          toolSlug,
          displayName,
          fields,
          helpUrl: def?.helpUrl,
        },
      })
    }

    // mode === "managed-oauth" — existing PR2.8a-fix1 path.
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
      mode: "oauth",
      redirectUrl: connectionRequest.redirectUrl,
      connectionId: connectionRequest.id,
    })
  } catch (err) {
    if (err instanceof ComposioToolkitRequiresCustomOAuthError) {
      // 422 Unprocessable: the request shape is fine but the targeted
      // toolkit isn't configured for managed-auth in our Composio project
      // AND doesn't expose API_KEY mode (so BYOK isn't an option either).
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
