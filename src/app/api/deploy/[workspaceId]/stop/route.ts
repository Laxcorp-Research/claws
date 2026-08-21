import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"

export const maxDuration = 60

/**
 * POST /api/deploy/[workspaceId]/stop
 *
 * Lifecycle P3:
 * - Default: destroy-anyway - sync fail surfaces syncWarning but Stop proceeds
 *   (user's call, their claw).
 * - ?force=1 (or body.force): ops FORCE - destroyPolicy force (skip refuse gates).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const urlForce = req.nextUrl.searchParams.get("force") === "1"
    || req.nextUrl.searchParams.get("force") === "true"
  let bodyForce = false
  try {
    const body = (await req.json()) as { force?: unknown }
    bodyForce = body?.force === true || body?.force === "1"
  } catch {
    // empty body is fine
  }
  const force = urlForce || bodyForce

  try {
    const { syncThenDestroy } = await import("@/lib/openclaw/deployer")
    // User Stop: serviceDelete is correct - operator asked to tear the box down.
    const result = await syncThenDestroy(workspaceId, {
      destroyPolicy: force ? "force" : "destroy-anyway",
    })
    // destroy-anyway / force always destroy; surface syncWarning when sync failed.
    return apiSuccess({
      stopped: true,
      status: "STOPPED",
      syncWarning: result.destroyed ? (result.syncWarning ?? null) : null,
      force,
    })
  } catch (err: unknown) {
    return apiError("STOP_FAILED", err instanceof Error ? err.message : "Stop failed", 500)
  }
}
