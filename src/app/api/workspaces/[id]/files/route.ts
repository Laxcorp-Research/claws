import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { writeWorkspaceSharedFile } from "@/lib/artifacts/live-write"
import { isSharedWritePath } from "@/lib/artifacts/workspace-file-allowlist"
import { loadWorkspaceFileCatalog } from "@/lib/artifacts/load-workspace-files"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id: workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const catalog = await loadWorkspaceFileCatalog(workspaceId)
  return apiSuccess(catalog)
}

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

  const body = (await request.json()) as { path?: unknown; content?: unknown }
  if (typeof body.path !== "string" || typeof body.content !== "string") {
    return ERRORS.VALIDATION("Required: path, content")
  }
  if (!isSharedWritePath(body.path)) return ERRORS.FORBIDDEN()

  const written = await writeWorkspaceSharedFile({
    workspaceId,
    logicalPath: body.path,
    content: body.content,
    createdBy: user.email ?? user.id,
    trigger: "EDIT",
  })
  if (!written.ok) {
    return apiError("LIVE_WRITE_FAILED", written.error, written.status)
  }
  return apiSuccess({
    fileVersionId: written.fileVersionId,
    version: written.version,
    unchanged: written.unchanged,
  })
}
