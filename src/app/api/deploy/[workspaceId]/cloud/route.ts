import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { deployToCloud } from "@/lib/openclaw/deployer"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  if (workspace?.status === "RUNNING") return apiError("ALREADY_RUNNING", "Workspace is already deployed and running", 400)

  try {
    const deployment = await deployToCloud(workspaceId)
    return apiSuccess(deployment, 201)
  } catch (err: unknown) {
    return apiError("DEPLOY_FAILED", err instanceof Error ? err.message : "Deployment failed", 500)
  }
}
