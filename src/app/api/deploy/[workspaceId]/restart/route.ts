import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { trialUsed: true, trialStartedAt: true, trialEndsAt: true, hasActiveSubscription: true },
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
