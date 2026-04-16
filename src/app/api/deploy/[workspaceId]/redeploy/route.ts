import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"

export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { containerId: true, status: true },
  })

  if (!workspace.containerId) {
    return apiError("NO_SERVICE", "No deployed service found for this workspace. Deploy first.", 400)
  }

  if (workspace.status !== "RUNNING" && workspace.status !== "ERROR") {
    return apiError("INVALID_STATUS", `Cannot redeploy a workspace in ${workspace.status} state.`, 400)
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { trialUsed: true, trialStartedAt: true, trialEndsAt: true, hasActiveSubscription: true },
  })
  const eligibility = checkDeployEligibility(owner)
  if (!eligibility.canDeploy) {
    return apiError(
      "SUBSCRIPTION_REQUIRED",
      "Your trial has ended. Subscribe to redeploy your Claw.",
      402,
    )
  }

  try {
    const { deployToCloud } = await import("@/lib/openclaw/deployer")
    const result = await deployToCloud(workspaceId)
    return apiSuccess({ deploymentId: result.deploymentId, containerId: result.containerId })
  } catch (err: unknown) {
    return apiError("REDEPLOY_FAILED", err instanceof Error ? err.message : "Redeploy failed", 500)
  }
}
