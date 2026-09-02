import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { writeWorkspaceSharedFile } from "@/lib/artifacts/live-write"
import { isSharedWritePath } from "@/lib/artifacts/workspace-file-allowlist"
import { loadApprovalVersionStates } from "@/lib/artifacts/supersede-versions"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileVersionId: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id: workspaceId, fileVersionId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const row = await prisma.fileVersion.findFirst({
    where: { id: fileVersionId, workspaceId },
  })
  if (!row) return ERRORS.NOT_FOUND("file version")

  const states = await loadApprovalVersionStates({
    workspaceId,
    logicalPaths: [row.logicalPath],
  })
  const state = states.get(row.id)

  return apiSuccess({
    id: row.id,
    logicalPath: row.logicalPath,
    version: row.version,
    content: row.content,
    decision: state?.decision ?? row.decision,
    isLatest: state?.isLatest ?? true,
    latestFileVersionId: state?.latestFileVersionId ?? row.id,
    latestLabel: state?.latestLabel ?? "",
    trigger: row.trigger,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileVersionId: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id: workspaceId, fileVersionId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = (await request.json()) as { content?: unknown }
  if (typeof body.content !== "string") return ERRORS.VALIDATION("Required: content")

  const existing = await prisma.fileVersion.findFirst({
    where: { id: fileVersionId, workspaceId },
  })
  if (!existing) return ERRORS.NOT_FOUND("file version")
  if (!isSharedWritePath(existing.logicalPath)) return ERRORS.FORBIDDEN()

  const written = await writeWorkspaceSharedFile({
    workspaceId,
    logicalPath: existing.logicalPath,
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
