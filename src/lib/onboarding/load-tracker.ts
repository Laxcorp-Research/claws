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

/**
 * Cheapest reads for the live tracker:
 * - User.onboardingCompleted + apiKeys.provider
 * - Workspace list (id/name/status)
 * - exists ToolConnection via workspace join
 * - exists Deployment status=COMPLETED via workspace join
 */
export async function loadGettingStartedTracker(
  userId: string,
): Promise<GettingStartedPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      onboardingCompleted: true,
      apiKeys: { select: { provider: true } },
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

  const hasToolConnection = user.workspaces.some((w) => w.toolConnections.length > 0)
  const hasCompletedDeployment = workspaces.some((w) => w.hasCompletedDeployment)
  const providers = user.apiKeys.map((k) => k.provider)

  return {
    mode: user.onboardingCompleted === true ? "revisit" : "gate",
    state: deriveTrackerState({
      providers,
      workspaces,
      hasToolConnection,
      hasCompletedDeployment,
    }),
    workspaces,
  }
}
