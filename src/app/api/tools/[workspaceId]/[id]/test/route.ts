import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { decrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { validateToolKey, hasValidator } from "@/lib/tools/validators"

/**
 * POST /api/tools/[workspaceId]/[id]/test
 *
 * Actually validates a stored API_KEY connection by calling the provider.
 * Before this endpoint existed, the UI's "Test" button called a PATCH that
 * the client itself populated with `status: "CONNECTED"` — the test was
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

  if (conn.connectionType !== "API_KEY") {
    return ERRORS.VALIDATION(
      "Test is only available for API-key connections. OAuth tools are verified through their reconnect flow.",
    )
  }

  // NEEDS_CREDENTIALS rows are known-incomplete; testing them will just
  // fail with "missing required field". Surface a better error that maps
  // onto the UI's Complete button flow.
  if (conn.status === "NEEDS_CREDENTIALS") {
    return ERRORS.VALIDATION(
      "Connection is missing credentials. Click 'Complete' to supply the remaining fields.",
    )
  }

  if (!conn.encryptedCredentials) {
    return ERRORS.VALIDATION(
      "This connection has no stored credentials. Reconnect to add them.",
    )
  }

  let credentials: Record<string, string>
  try {
    const plaintext = decrypt(conn.encryptedCredentials)
    const parsed = JSON.parse(plaintext)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("encryptedCredentials plaintext is not a JSON object")
    }
    credentials = parsed as Record<string, string>
  } catch (err) {
    log.error("Failed to decrypt tool credentials", {
      category: "tool_validation",
      toolSlug: conn.toolSlug,
      error: err instanceof Error ? err.message : String(err),
    })
    return ERRORS.VALIDATION(
      "Couldn't read the stored credentials. Remove and reconnect this tool.",
    )
  }

  // If there's no validator for this tool, don't change status — just
  // report honestly that we can't actually verify it right now.
  if (!hasValidator(conn.toolSlug)) {
    await prisma.toolConnection.update({
      where: { id },
      data: { lastTestedAt: new Date() },
    })
    return apiSuccess({
      valid: true,
      unverified: true,
      message:
        "No validator implemented for this tool yet — we can't actually test it from here. The key is saved; the tool will fail at call time if it's wrong.",
      status: conn.status,
    })
  }

  const result = await validateToolKey(conn.toolSlug, credentials)

  if (!result.valid) {
    const updated = await prisma.toolConnection.update({
      where: { id },
      data: {
        status: "ERROR",
        lastTestedAt: new Date(),
        lastError: result.error ?? "Test failed",
      },
      select: { status: true, lastError: true },
    })
    log.toolEvent({
      event: "failed",
      toolSlug: conn.toolSlug,
      connectionType: conn.connectionType,
      workspaceId,
      userId: user.id,
      error: result.error,
    })
    return apiSuccess({
      valid: false,
      error: result.error,
      status: updated.status,
    })
  }

  // Transient provider error — treat as pending, not connected.
  if (result.warning) {
    const updated = await prisma.toolConnection.update({
      where: { id },
      data: {
        status: "PENDING",
        lastTestedAt: new Date(),
        lastError: result.warning,
      },
      select: { status: true, lastError: true },
    })
    return apiSuccess({
      valid: true,
      warning: result.warning,
      status: updated.status,
    })
  }

  const updated = await prisma.toolConnection.update({
    where: { id },
    data: {
      status: "CONNECTED",
      lastTestedAt: new Date(),
      lastError: null,
    },
    select: { status: true, lastError: true },
  })
  return apiSuccess({ valid: true, status: updated.status })
}
