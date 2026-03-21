import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, ERRORS } from "@/lib/api/response"
import { exportForSelfHosting } from "@/lib/openclaw/deployer"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  try {
    const zipBuffer = await exportForSelfHosting(workspaceId)
    return new Response(zipBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="claws-${workspaceId}.zip"`,
      },
    })
  } catch (err: unknown) {
    return apiError("EXPORT_FAILED", err instanceof Error ? err.message : "Export failed", 500)
  }
}
