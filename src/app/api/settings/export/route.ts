import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { ERRORS } from "@/lib/api/response"

/**
 * GET /api/settings/export - the account-data export both the ToS ("You can
 * export your account data from Settings at any time") and the privacy
 * policy promise. Downloads a JSON snapshot of the user's data.
 *
 * SECURITY: exports the user's OWN data only, and NEVER secret material -
 * no encrypted blobs (API keys, channel configs, gateway/device tokens),
 * no key hints beyond what Settings already shows. Locked by the
 * no-secret-fields test.
 */
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      onboardingCompleted: true,
      hasActiveSubscription: true,
      subscriptionStatus: true,
      trialUsed: true,
      trialStartedAt: true,
      trialEndsAt: true,
      apiKeySource: true,
      creditAccount: {
        select: {
          initialGrantCents: true,
          balanceCents: true,
          totalConsumedCents: true,
          status: true,
          grantedAt: true,
        },
      },
    },
  })

  const workspaces = await prisma.workspace.findMany({
    where: { userId: sessionUser.id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      provider: true,
      timezone: true,
      deliveryMode: true,
      maxRevisionRounds: true,
      alwaysOn: true,
      canceledAt: true,
      stateRetainedUntil: true,
      createdAt: true,
      clawTemplate: { select: { name: true, slug: true } },
      agents: {
        select: {
          agentSlug: true,
          name: true,
          role: true,
          model: true,
          roleDescription: true,
          soulMd: true,
          agentsMd: true,
          heartbeatMd: true,
          userMd: true,
        },
      },
      toolConnections: {
        select: {
          toolSlug: true,
          connectionType: true,
          displayName: true,
          status: true,
          createdAt: true,
        },
      },
    },
  })

  const purchases = await prisma.purchase.findMany({
    where: { userId: sessionUser.id },
    select: {
      id: true,
      clawTemplate: { select: { name: true, slug: true } },
      amountPaid: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  })

  const activitySummary = await prisma.activityLog.findMany({
    where: { workspaceId: { in: workspaces.map((w) => w.id) } },
    orderBy: { timestamp: "desc" },
    take: 1000,
    select: {
      workspaceId: true,
      agentSlug: true,
      action: true,
      actionType: true,
      timestamp: true,
    },
  })

  const payload = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    user,
    workspaces,
    purchases,
    activitySummary,
  }

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="claws-account-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  })
}
