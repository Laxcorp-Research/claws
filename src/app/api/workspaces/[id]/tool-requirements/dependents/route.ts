import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import {
  formatDependentHitLabel,
  resolveToolDependents,
} from "@/lib/tools/tool-dependents"

/**
 * GET ?slug= - labeled agent dependents for REMOVE warning dialog.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const slug = req.nextUrl.searchParams.get("slug")?.trim() ?? ""
  if (!slug) return ERRORS.VALIDATION("slug query parameter is required")

  const result = await resolveToolDependents(id, slug)
  return apiSuccess({
    ...result,
    labels: result.hits.map(formatDependentHitLabel),
  })
}
