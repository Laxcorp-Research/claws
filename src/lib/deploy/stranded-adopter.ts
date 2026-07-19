import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

/** Env: STRANDED_DEPLOY_MAX_AGE_MIN (default 10). */
export const DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN = 10

export function strandedDeployMaxAgeMs(): number {
  const raw = process.env.STRANDED_DEPLOY_MAX_AGE_MIN
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN
  const minutes =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN
  return minutes * 60 * 1000
}

export const STRANDED_DEPLOY_ERROR =
  "Deployment stranded: stuck in GENERATING/PROVISIONING beyond max age — marked FAILED for retry"

/**
 * Resolve workspace status after a stranded deploy is adopted.
 * Wake path → HIBERNATED (retriable). Fresh DEPLOYING → STOPPED if a prior
 * container existed, else DRAFT.
 */
export function resolvePreDeployWorkspaceStatus(args: {
  workspaceStatus: string
  containerPhase: string | null | undefined
  hadContainerId: boolean
}): { status: "HIBERNATED" | "STOPPED" | "DRAFT"; containerPhase: "HIBERNATED" | "STOPPED" } {
  if (args.workspaceStatus === "WAKING" || args.containerPhase === "WAKING") {
    return { status: "HIBERNATED", containerPhase: "HIBERNATED" }
  }
  if (args.hadContainerId) {
    return { status: "STOPPED", containerPhase: "STOPPED" }
  }
  return { status: "DRAFT", containerPhase: "STOPPED" }
}

/**
 * Lifecycle P4 watchdog: adopt deployments stuck in GENERATING/PROVISIONING
 * beyond STRANDED_DEPLOY_MAX_AGE_MIN. Marks Deployment FAILED and converges
 * workspace to a retriable pre-deploy status.
 */
export async function adoptStrandedDeployments(
  nowMs: number = Date.now(),
): Promise<{ adopted: number; errors: string[] }> {
  const cutoff = new Date(nowMs - strandedDeployMaxAgeMs())
  const stranded = await prisma.deployment.findMany({
    where: {
      status: { in: ["GENERATING", "PROVISIONING"] },
      startedAt: { lt: cutoff },
      completedAt: null,
    },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      startedAt: true,
      workspace: {
        select: {
          id: true,
          status: true,
          containerId: true,
          containerState: { select: { containerPhase: true } },
        },
      },
    },
    take: 50,
  })

  let adopted = 0
  const errors: string[] = []

  for (const dep of stranded) {
    try {
      const restored = resolvePreDeployWorkspaceStatus({
        workspaceStatus: dep.workspace.status,
        containerPhase: dep.workspace.containerState?.containerPhase,
        hadContainerId: Boolean(dep.workspace.containerId),
      })

      await prisma.$transaction([
        prisma.deployment.update({
          where: { id: dep.id },
          data: {
            status: "FAILED",
            errorMessage: STRANDED_DEPLOY_ERROR,
            completedAt: new Date(nowMs),
          },
        }),
        prisma.workspace.update({
          where: { id: dep.workspaceId },
          data: { status: restored.status },
        }),
        prisma.containerState.updateMany({
          where: { workspaceId: dep.workspaceId },
          data: {
            containerPhase: restored.containerPhase,
            wakeRequestedAt: null,
          },
        }),
      ])

      adopted++
      log.warn("stranded-adopter: adopted stuck deployment", {
        deploymentId: dep.id,
        workspaceId: dep.workspaceId,
        priorDeployStatus: dep.status,
        restoredWorkspaceStatus: restored.status,
        startedAt: dep.startedAt.toISOString(),
      })
    } catch (err) {
      errors.push(`${dep.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { adopted, errors }
}
