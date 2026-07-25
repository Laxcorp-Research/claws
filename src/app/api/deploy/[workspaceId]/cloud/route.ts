import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"
import { log } from "@/lib/logger"
import { evaluateWorkspaceDeployToolPrerequisites } from "@/lib/tools/deploy-tool-prerequisites"
import { missingRequiredToolsBannerTitle } from "@/lib/tools/required-tools"

export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, sessionUser.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  if (workspace?.status === "RUNNING" && workspace.containerId) return apiError("ALREADY_RUNNING", "Workspace is already deployed and running", 400)

  // Finding F server parity (#282): same requiredToolsSatisfied gate as Setup
  // Step 3 â€” before eligibility side effects / deployToCloud.
  const toolPrereqs = await evaluateWorkspaceDeployToolPrerequisites(workspaceId)
  if (!toolPrereqs.satisfied) {
    return apiError(
      "REQUIRED_TOOLS_MISSING",
      missingRequiredToolsBannerTitle(toolPrereqs.missingLabels),
      400,
    )
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      id: true,
      trialUsed: true,
      trialStartedAt: true,
      trialEndsAt: true,
      hasActiveSubscription: true,
    },
  })

  const eligibility = checkDeployEligibility(user)

  if (eligibility.isFirstDeploy) {
    const now = new Date()
    await prisma.user.update({
      where: { id: user.id },
      data: {
        trialUsed: true,
        trialStartedAt: now,
        trialEndsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
    })
  }

  if (!eligibility.canDeploy) {
    return apiError(
      "SUBSCRIPTION_REQUIRED",
      "Your 3-day trial has ended. Subscribe to the Claw Platform ($79/mo) to keep your Claws running.",
      402,
    )
  }

  try {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "DEPLOYING" },
    })

    log.deployEvent({ event: "started", workspaceId, userId: user.id })

    // Kick off the full deploy pipeline (generates files, creates Railway service, etc.)
    // Uses Railway when configured, simulation otherwise.
    const { deployToCloud } = await import("@/lib/openclaw/deployer")
    const result = await deployToCloud(workspaceId)

    log.deployEvent({ event: "completed", workspaceId, userId: user.id })

    return apiSuccess({
      deployment: {
        id: result.deploymentId,
        containerId: result.containerId,
        status: "COMPLETED",
      },
    }, 201)
  } catch (err: unknown) {
    log.deployEvent({
      event: "failed",
      workspaceId,
      userId: user.id,
      error: err instanceof Error ? err.message : "Unknown",
    })
    const msg = err instanceof Error ? err.message : "Deployment failed"
    return apiError("DEPLOY_FAILED", msg.length > 300 ? `${msg.substring(0, 300)}â€¦` : msg, 500)
  }
}
