import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"

export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  // Precondition: workspace must have a live Railway service (containerId set)
  // AND be in a state where a restart is meaningful (RUNNING - kick the service;
  // ERROR - recover from a failed deploy). Every other state needs a different
  // endpoint:
  //   - STOPPED / PAUSED with null containerId: use /cloud to redeploy from scratch
  //   - HIBERNATED: wake via the hibernation flow
  //   - DEPLOYING / WAKING: wait; a restart mid-flight races the deploy
  //   - DRAFT / SETUP_INCOMPLETE: finish setup, then /cloud
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { containerId: true, status: true },
  })

  if (!workspace.containerId) {
    return apiError(
      "WORKSPACE_NOT_RESTARTABLE",
      "Workspace has no deployed container. Use /api/deploy/[id]/cloud to redeploy.",
      400,
    )
  }

  if (workspace.status !== "RUNNING" && workspace.status !== "ERROR") {
    return apiError(
      "WORKSPACE_NOT_RESTARTABLE",
      `Cannot restart a workspace in ${workspace.status} state. Use /api/deploy/[id]/cloud to redeploy.`,
      400,
    )
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { trialUsed: true, trialStartedAt: true, trialEndsAt: true, hasActiveSubscription: true, subscriptionStatus: true, subscriptionOnHoldAt: true },
  })
  const eligibility = checkDeployEligibility(owner)
  if (!eligibility.canDeploy) {
    return apiError(
      "SUBSCRIPTION_REQUIRED",
      "Your trial has ended. Subscribe to restart your Claw.",
      402,
    )
  }

  try {
    const { restartContainer } = await import("@/lib/openclaw/deployer")
    await restartContainer(workspaceId)
    return apiSuccess({ restarted: true })
  } catch (err: unknown) {
    return apiError("RESTART_FAILED", err instanceof Error ? err.message : "Restart failed", 500)
  }
}
