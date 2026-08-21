import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio } from "@/lib/composio"
import { log } from "@/lib/logger"

/**
 * Client-facing poll status. The setup wizard polls this endpoint during
 * the consent-complete wait; it switches on a narrow tri-state (ACTIVE =
 * user finished consent, FAILED = give up, PENDING = keep polling).
 * Additional granularity (EXPIRED vs REVOKED vs generic FAILED) is
 * irrelevant DURING consent - all three mean "not connected now". It
 * matters for the DB write below so downstream UI can differentiate.
 */
type PollStatus = "PENDING" | "ACTIVE" | "FAILED"

function mapComposioStatus(raw: string): PollStatus {
  if (raw === "ACTIVE") return "ACTIVE"
  // PR #4 Commit 6: REVOKED joins FAILED/EXPIRED as a terminal "not
  // connected" signal for the client poll. All three drive the DB-side
  // failure branch below; the DB write picks the distinct enum value.
  if (raw === "FAILED" || raw === "EXPIRED" || raw === "REVOKED") return "FAILED"
  return "PENDING"
}

/**
 * PR #4 Commit 6: the third-consumer un-collapse. Before this commit,
 * Composio's EXPIRED state was coerced via mapComposioStatus → "FAILED"
 * → DB write `status: "ERROR"`. That meant the `EXPIRED` and `REVOKED`
 * values in our `ToolConnectionStatus` Prisma enum were dead - they
 * never got written by the primary OAuth-poll path regardless of what
 * Composio reported. Dashboard banner copy and ToolRow rendering for
 * expired OAuth tokens (Commit 6's D5 spec) would have been dead code.
 *
 * Now: map Composio's raw status to our DB enum distinctly so:
 *   - EXPIRED connections surface with "Your OAuth token has expired"
 *     copy + Reconnect button rather than the generic "Connection failed".
 *   - REVOKED connections differ semantically from EXPIRED in audit logs
 *     even if the user-facing copy is the same ("Token expired -
 *     reconnect required").
 *   - Unknown / unrecognized Composio states fall through to ERROR,
 *     which is the safe default (generic error banner + Retry button).
 */
function mapToDbErrorStatus(raw: string): "EXPIRED" | "REVOKED" | "ERROR" {
  if (raw === "EXPIRED") return "EXPIRED"
  if (raw === "REVOKED") return "REVOKED"
  return "ERROR"
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
        data: {
          status: mapToDbErrorStatus(rawStatus),
          lastError: `Composio status: ${rawStatus}`,
        },
      })
    }

    return apiSuccess({ status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn("Composio status check failed", { connectionId, error: message })
    return apiSuccess({ status: "PENDING" as const })
  }
}
