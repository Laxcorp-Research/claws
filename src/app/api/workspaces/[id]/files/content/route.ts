import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { loadWorkspaceFileDetail } from "@/lib/artifacts/load-workspace-files"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id: workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const path = request.nextUrl.searchParams.get("path")
  if (!path) return ERRORS.VALIDATION("Required: path")

  const detail = await loadWorkspaceFileDetail(workspaceId, path)
  if ("error" in detail) {
    return apiError("FILE_READ_FAILED", detail.error, detail.status)
  }
  return apiSuccess(detail)
}
