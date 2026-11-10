import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { checkDeployEligibility } from "@/lib/dodo-payments"
import { log } from "@/lib/logger"
import { evaluateWorkspaceDeployToolPrerequisites } from "@/lib/tools/deploy-tool-prerequisites"
import { missingRequiredToolsBannerTitle } from "@/lib/tools/required-tools"
import { evaluateWorkspaceDeployTopologyPrerequisites } from "@/lib/openclaw/deploy-topology-prerequisites"
import {
  evaluateWorkspaceDeployProviderAuth,
  PROVIDER_AUTH_MISSING,
} from "@/lib/deploy/provider-auth-prerequisites"
import {
  evaluateCreateBudget,
  enqueueProvisioning,
  isProvisioningQueuedError,
} from "@/lib/railway/governor"
import {
  FINANCIAL_ACK_LABEL,
  FINANCIAL_ACK_REQUIRED_CODE,
  isFinancialTemplateSlug,
} from "@/lib/legal/consent"
import { hasConsent, recordConsent } from "@/lib/legal/consent-server"
import { isEntitled } from "@/lib/entitlement"
import { isSelfHost } from "@/lib/profile"
import { readRuntimeImage } from "@/lib/openclaw/runtime-image"
import { RUNTIME_IMAGE_MISSING_BANNER } from "@/lib/openclaw/runtime-image-message"

export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, sessionUser.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  if (isSelfHost()) {
    const runtimeImage = await readRuntimeImage()
    if (runtimeImage && !runtimeImage.present) {
      return apiError(
        "RUNTIME_IMAGE_MISSING",
        RUNTIME_IMAGE_MISSING_BANNER,
        409,
      )
    }
  }

  if (workspace?.status === "RUNNING" && workspace.containerId) return apiError("ALREADY_RUNNING", "Workspace is already deployed and running", 400)

  // B-1: keyless deploy hard-block. No auth path for a required provider
  // must never become a dead boot. MUTATION: remove this gate → keyless
  // deploy-bypass test fails.
  const providerAuth = await evaluateWorkspaceDeployProviderAuth(workspaceId)
  if (!providerAuth.ok) {
    return apiError(PROVIDER_AUTH_MISSING, providerAuth.message, 400)
  }

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

  // WIRE-FULL: topology hard-block (sibling to required-tools).
  // MUTATION: remove this gate → topology deploy-bypass test fails.
  const topology = await evaluateWorkspaceDeployTopologyPrerequisites(workspaceId)
  if (!topology.ok) {
    return apiError(
      "TOPOLOGY_INVALID",
      topology.primaryMessage ?? "Fix your team connections before deploying.",
      400,
    )
  }

  // Legal: FIRST deploy of a financial template requires the §8
  // acknowledgement ("I've read the AI & autonomy terms (§8)"), stored as a
  // ConsentRecord. Sits BEFORE the trial-start side effect so an unacked
  // attempt never burns the trial clock. The client retries with
  // { financialAckAccepted: true } after showing the dialog.
  // MUTATION: remove this gate → financial deploy-bypass test fails.
  const wsTemplate = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { clawTemplate: { select: { slug: true } } },
  })
  const templateSlug = wsTemplate?.clawTemplate?.slug ?? null
  if (isFinancialTemplateSlug(templateSlug)) {
    const acked = await hasConsent({
      userId: sessionUser.id,
      kind: "FINANCIAL_AUTONOMY_S8",
      workspaceId,
    })
    if (!acked) {
      let ackAccepted = false
      try {
        const body = (await req.json()) as { financialAckAccepted?: unknown }
        ackAccepted = body?.financialAckAccepted === true
      } catch {
        // No/invalid body - legacy callers deploy without one.
      }
      if (!ackAccepted) {
        return apiError(
          FINANCIAL_ACK_REQUIRED_CODE,
          `This template can act on financial accounts. Confirm "${FINANCIAL_ACK_LABEL}" to deploy.`,
          428,
        )
      }
      await recordConsent({
        userId: sessionUser.id,
        kind: "FINANCIAL_AUTONOMY_S8",
        workspaceId,
        source: "deploy-gate",
        metadata: { templateSlug },
      })
    }
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      id: true,
      trialUsed: true,
      trialStartedAt: true,
      trialEndsAt: true,
      hasActiveSubscription: true,
      subscriptionStatus: true,
      subscriptionOnHoldAt: true,
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

  // Existing-service reuse (HWD wake / redeploy with containerId) bypasses
  // the create governor - those paths never serviceCreate.
  // isEntitled("deploy_limit", false) is true only in self-host, so this
  // block does not call evaluateCreateBudget there.
  if (!workspace?.containerId && !isEntitled("deploy_limit", false)) {
    const budget = await evaluateCreateBudget()
    if (!isEntitled("deploy_limit", budget.allowed)) {
      const queued = await enqueueProvisioning(workspaceId, "budget")
      return apiSuccess(
        {
          queued: true,
          position: queued.position,
          etaAt: queued.etaAt.toISOString(),
          message: queued.message,
        },
        202,
      )
    }
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
        ...(result.gatewayListening ? { gatewayListening: true } : {}),
      },
    }, 201)
  } catch (err: unknown) {
    if (isProvisioningQueuedError(err)) {
      return apiSuccess(
        {
          queued: true,
          position: err.queued.position,
          etaAt: err.queued.etaAt.toISOString(),
          message: err.queued.message,
        },
        202,
      )
    }
    log.deployEvent({
      event: "failed",
      workspaceId,
      userId: user.id,
      error: err instanceof Error ? err.message : "Unknown",
    })
    const msg = err instanceof Error ? err.message : "Deployment failed"
    return apiError("DEPLOY_FAILED", msg.length > 300 ? `${msg.substring(0, 300)}…` : msg, 500)
  }
}
