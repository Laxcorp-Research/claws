import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio, getComposioUserId } from "@/lib/composio"
import {
  createBYOKConnectedAccount,
  classifyToolkitAuthMode,
  fetchToolkitWithAuthMode,
} from "@/lib/composio-auth-config"
import { getToolBySlug } from "@/data/tool-catalog"
import { log } from "@/lib/logger"

export const maxDuration = 30

// PR2.9 — BYOK submit. The wizard / browse-modal POSTs here with the
// user's API key after the `oauth/initiate` route returned `mode: "byok"`
// + apiKeyForm. This is the synchronous-creation counterpart to the
// async OAuth flow:
//
//   - No popup, no poll, no PENDING state.
//   - Composio returns the connection as ACTIVE immediately (verified by
//     --byok-probe).
//   - ToolConnection row is upserted with status: CONNECTED on success.
//
// Security:
//   - User API key is never logged. The helper layer
//     (createBYOKConnectedAccount) enforces this; this route adds belt-
//     and-suspenders by never including `apiKey` in any error or audit
//     log line.
//   - encryptedCredentials: null on the ToolConnection row — Composio holds
//     the key, not us. Same posture as our existing OAUTH_COMPOSIO rows.
//   - Auth-guarded identical to oauth/initiate.
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
      "Tool connections are not configured. Set COMPOSIO_API_KEY or contact support.",
      503
    )
  }

  const body = (await req.json().catch(() => null)) as { toolSlug?: string; apiKey?: string } | null
  if (!body) return ERRORS.VALIDATION("Request body must be JSON")
  const { toolSlug, apiKey } = body

  if (!toolSlug || typeof toolSlug !== "string") {
    return ERRORS.VALIDATION("toolSlug is required")
  }
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return ERRORS.VALIDATION("apiKey is required")
  }

  const def = getToolBySlug(toolSlug)
  const displayName = def?.name ?? toolSlug
  const toolkitSlug = def?.composioToolkitId ?? toolSlug

  try {
    // Verify the toolkit really is BYOK-eligible before accepting the
    // user's key. Defense against a malicious client POSTing a key for a
    // managed-OAuth toolkit slug (where the key would be discarded by
    // Composio at execute time, leaving a confusingly-CONNECTED row).
    //
    // Single toolkits.get call here (createBYOKConnectedAccount will do
    // another one inside ensureBYOKAuthConfig — acceptable, classifier is
    // cheap; could be optimized later by passing toolkit through).
    const { toolkit } = await fetchToolkitWithAuthMode(composio, toolkitSlug)
    const mode = classifyToolkitAuthMode(toolkit)
    if (mode !== "byok-api-key") {
      return apiError(
        "BYOK_NOT_SUPPORTED_FOR_TOOLKIT",
        `Toolkit "${toolkitSlug}" doesn't accept a user-supplied API key. Use the OAuth flow instead.`,
        400
      )
    }

    const composioUserId = getComposioUserId(user.id)
    const composioConnectionId = await createBYOKConnectedAccount(
      composio,
      composioUserId,
      toolkitSlug,
      apiKey
    )

    const connection = await prisma.toolConnection.upsert({
      where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
      create: {
        workspaceId,
        toolSlug,
        displayName,
        connectionType: "OAUTH_COMPOSIO",
        composioConnectionId,
        composioEntityId: composioUserId,
        // BYOK is synchronous: Composio returns ACTIVE immediately, so
        // there's no PENDING intermediate state to wait through. The
        // ToolConnection row goes straight to CONNECTED. Differs from
        // the managed-OAuth path which goes PENDING → CONNECTED via the
        // status-polling loop.
        status: "CONNECTED",
        // encryptedCredentials stays null — Composio holds the user's
        // key, not us. Same posture as every OAUTH_COMPOSIO row.
      },
      update: {
        displayName,
        composioConnectionId,
        composioEntityId: composioUserId,
        status: "CONNECTED",
        lastError: null,
      },
      select: { id: true, toolSlug: true, status: true },
    })

    log.toolEvent({
      event: "connected",
      toolSlug,
      connectionType: "OAUTH_COMPOSIO",
      workspaceId,
      userId: user.id,
    })

    return apiSuccess({
      connection: {
        id: connection.id,
        toolSlug: connection.toolSlug,
        status: connection.status,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect tool"
    // toolSlug is fine to log; apiKey IS NOT and must never appear in
    // any log line. The createBYOKConnectedAccount helper enforces this;
    // we add belt-and-suspenders by destructuring out only `message`.
    log.error("BYOK submit failed", { toolSlug, workspaceId, error: message })
    return apiError("BYOK_SUBMIT_FAILED", message, 500)
  }
}
