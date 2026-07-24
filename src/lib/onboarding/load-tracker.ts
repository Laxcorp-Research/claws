import { prisma } from "@/lib/db"
import {
  deriveTrackerState,
  type TrackerState,
  type TrackerWorkspace,
  type TrackerWorkspaceStatus,
} from "@/lib/onboarding/tracker-state"

export type GettingStartedPayload = {
  mode: "gate" | "revisit"
  state: TrackerState
  workspaces: TrackerWorkspace[]
}

export type OnboardingStateSteps = {
  s1: boolean
  s2: boolean
  s3: boolean
}

/**
 * Shared cheap reads for tracker page + GET /api/onboarding/state.
 * Balance = CreditAccount.balanceCents (same as /api/credits/balance / wizard banner).
 */
export async function loadTrackerInputs(userId: string): Promise<{
  onboardingCompleted: boolean
  providers: string[]
  balanceCents: number | null
  workspaces: TrackerWorkspace[]
  hasToolConnection: boolean
  hasCompletedDeployment: boolean
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      onboardingCompleted: true,
      apiKeys: { select: { provider: true } },
      creditAccount: { select: { balanceCents: true } },
      workspaces: {
        select: {
          id: true,
          name: true,
          status: true,
          toolConnections: { select: { id: true }, take: 1 },
          deployments: {
            where: { status: "COMPLETED" },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!user) return null

  const workspaces: TrackerWorkspace[] = user.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    status: w.status as TrackerWorkspaceStatus,
    hasCompletedDeployment: w.deployments.length > 0,
  }))

  return {
    onboardingCompleted: user.onboardingCompleted === true,
    providers: user.apiKeys.map((k) => k.provider),
    balanceCents: user.creditAccount?.balanceCents ?? null,
    workspaces,
    hasToolConnection: user.workspaces.some((w) => w.toolConnections.length > 0),
    hasCompletedDeployment: workspaces.some((w) => w.hasCompletedDeployment),
  }
}

export async function loadGettingStartedTracker(
  userId: string,
): Promise<GettingStartedPayload | null> {
  const raw = await loadTrackerInputs(userId)
  if (!raw) return null

  return {
    mode: raw.onboardingCompleted ? "revisit" : "gate",
    state: deriveTrackerState({
      providers: raw.providers,
      balanceCents: raw.balanceCents,
      workspaces: raw.workspaces,
      hasToolConnection: raw.hasToolConnection,
      hasCompletedDeployment: raw.hasCompletedDeployment,
    }),
    workspaces: raw.workspaces,
  }
}

export async function loadOnboardingStateSteps(
  userId: string,
): Promise<OnboardingStateSteps | null> {
  const tracker = await loadGettingStartedTracker(userId)
  if (!tracker) return null
  return {
    s1: tracker.state.s1Done,
    s2: tracker.state.s2Done,
    s3: tracker.state.s3Done,
  }
}
