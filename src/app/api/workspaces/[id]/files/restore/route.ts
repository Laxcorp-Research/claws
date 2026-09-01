import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { restoreWorkspaceFileVersion } from "@/lib/artifacts/load-workspace-files"

export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id: workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = (await request.json()) as { fileVersionId?: unknown }
  if (typeof body.fileVersionId !== "string" || body.fileVersionId.length === 0) {
    return ERRORS.VALIDATION("Required: fileVersionId")
  }

  const written = await restoreWorkspaceFileVersion({
    workspaceId,
    fileVersionId: body.fileVersionId,
    restoredBy: user.email ?? user.id,
  })
  if (!written.ok) {
    return apiError("RESTORE_FAILED", written.error, written.status)
  }
  return apiSuccess({
    fileVersionId: written.fileVersionId,
    version: written.version,
    unchanged: written.unchanged,
    trigger: "RESTORE",
  })
}
