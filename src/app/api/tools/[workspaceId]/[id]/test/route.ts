import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import {
  ledgerToolStatusProbe,
  probeAndPersistApiKeyConnection,
} from "@/lib/tools/probe-api-key"

/**
 * POST /api/tools/[workspaceId]/[id]/test
 *
 * Actually validates a stored API_KEY connection by calling the provider.
 * Before this endpoint existed, the UI's "Test" button called a PATCH that
 * the client itself populated with `status: "CONNECTED"` - the test was
 * client-declared success, not a real provider round-trip.
 *
 * Response shape:
 *   { valid: true }                              verified working
 *   { valid: true, warning }                     provider 5xx; status left
 *                                                as PENDING
 *   { valid: true, unverified: true, message }   no validator implemented
 *                                                for this tool; status is
 *                                                NOT changed
 *   { valid: false, error }                      explicitly invalid; row
 *                                                marked ERROR
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const conn = await prisma.toolConnection.findFirst({
    where: { id, workspaceId },
  })
  if (!conn) return ERRORS.NOT_FOUND("Tool connection")

  const probed = await probeAndPersistApiKeyConnection(conn, { userId: user.id })
  if (!probed.ok) {
    if (probed.failure.kind === "not_api_key") {
      return ERRORS.VALIDATION(
        "Test is only available for API-key connections. OAuth tools are verified through their reconnect flow.",
      )
    }
    if (probed.failure.kind === "needs_credentials") {
      return ERRORS.VALIDATION(
        "Connection is missing credentials. Click 'Complete' to supply the remaining fields.",
      )
    }
    if (probed.failure.kind === "no_credentials") {
      return ERRORS.VALIDATION(
        "This connection has no stored credentials. Reconnect to add them.",
      )
    }
    return ERRORS.VALIDATION(
      probed.failure.error ??
        "Couldn't read the stored credentials. Remove and reconnect this tool.",
    )
  }

  const result = probed.result
  await ledgerToolStatusProbe({
    workspaceId,
    trigger: "user_request",
    results: [
      { toolSlug: result.toolSlug, outcome: result.outcome, status: result.status },
    ],
  })

  if (result.outcome === "unverified") {
    return apiSuccess({
      valid: true,
      unverified: true,
      message: result.message,
      status: result.status,
    })
  }
  if (result.outcome === "error") {
    return apiSuccess({
      valid: false,
      error: result.error,
      status: result.status,
    })
  }
  if (result.outcome === "pending") {
    return apiSuccess({
      valid: true,
      warning: result.warning,
      status: result.status,
    })
  }
  return apiSuccess({ valid: true, status: result.status })
}
