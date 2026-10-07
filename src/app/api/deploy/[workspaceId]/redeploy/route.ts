import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"
import { evaluateWorkspaceDeployToolPrerequisites } from "@/lib/tools/deploy-tool-prerequisites"
import { missingRequiredToolsBannerTitle } from "@/lib/tools/required-tools"
import { evaluateWorkspaceDeployTopologyPrerequisites } from "@/lib/openclaw/deploy-topology-prerequisites"

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

  if (workspace.status === "DRAFT" || workspace.status === "SETUP_INCOMPLETE") {
    return apiError(
      "SETUP_REQUIRED",
      `Cannot redeploy a workspace in ${workspace.status} state. Finish setup before deploying.`,
      400,
    )
  }

  if (workspace.status === "DEPLOYING" || workspace.status === "WAKING") {
    return apiError(
      "WORKSPACE_BUSY",
      `Cannot redeploy while the workspace is ${workspace.status}. Wait for the current operation to finish.`,
      409,
    )
  }

  if (!workspace.containerId && workspace.status !== "ERROR" && workspace.status !== "STOPPED") {
    return apiError(
      "NO_SERVICE",
      `Workspace has no deployed service in ${workspace.status} state. Use the deploy flow for this state.`,
      400,
    )
  }

  // Finding F server parity (#282): same gate as cloud deploy, before eligibility.
  const toolPrereqs = await evaluateWorkspaceDeployToolPrerequisites(workspaceId)
  if (!toolPrereqs.satisfied) {
    return apiError(
      "REQUIRED_TOOLS_MISSING",
      missingRequiredToolsBannerTitle(toolPrereqs.missingLabels),
      400,
    )
  }

  // WIRE-FULL: topology hard-block (sibling to required-tools).
  const topology = await evaluateWorkspaceDeployTopologyPrerequisites(workspaceId)
  if (!topology.ok) {
    return apiError(
      "TOPOLOGY_INVALID",
      topology.primaryMessage ?? "Fix your team connections before redeploying.",
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
      "Your trial has ended. Subscribe to redeploy your Claw.",
      402,
    )
  }

  try {
    const { redeployWorkspace } = await import("@/lib/openclaw/deployer")
    const result = await redeployWorkspace(workspaceId)
    return apiSuccess({ deploymentId: result.deploymentId, containerId: result.containerId })
  } catch (err: unknown) {
    return apiError("REDEPLOY_FAILED", err instanceof Error ? err.message : "Redeploy failed", 500)
  }
}
