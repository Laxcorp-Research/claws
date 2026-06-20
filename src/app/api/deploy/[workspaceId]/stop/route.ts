import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"

export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  try {
    // PR-2: route Stop through syncThenDestroy so the container's runtime
    // state is confirmed-persisted before teardown. It never throws on a sync
    // failure (destroys anyway + records an incomplete-sync marker), so a slow
    // or unreachable container can never trap the user on the Stop button.
    // Single workspace under maxDuration=60 → full default (~18s) sync budget.
    const { syncThenDestroy } = await import("@/lib/openclaw/deployer")
    await syncThenDestroy(workspaceId)
    return apiSuccess({ stopped: true })
  } catch (err: unknown) {
    return apiError("STOP_FAILED", err instanceof Error ? err.message : "Stop failed", 500)
  }
}
