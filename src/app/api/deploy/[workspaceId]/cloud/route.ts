import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, sessionUser.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  if (workspace?.status === "RUNNING") return apiError("ALREADY_RUNNING", "Workspace is already deployed and running", 400)

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
    const { deployToCloud } = await import("@/lib/openclaw/deployer")
    const deployment = await deployToCloud(workspaceId)
    return apiSuccess(deployment, 201)
  } catch (err: unknown) {
    return apiError("DEPLOY_FAILED", err instanceof Error ? err.message : "Deployment failed", 500)
  }
}
