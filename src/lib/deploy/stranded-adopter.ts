import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { computeNextHeartbeatAt } from "@/lib/hibernation/next-heartbeat"

/** Env: STRANDED_DEPLOY_MAX_AGE_MIN (default 10). */
export const DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN = 10

export function strandedDeployMaxAgeMs(): number {
  const raw = process.env.STRANDED_DEPLOY_MAX_AGE_MIN
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN
  const minutes =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STRANDED_DEPLOY_MAX_AGE_MIN
  return minutes * 60 * 1000
}

/**
 * DeploymentStatus enum (prisma) — terminal vs in-flight.
 * There is no STARTING_GATEWAY in the schema; gateway boot uses STARTING.
 *
 * Terminal: COMPLETED | FAILED | ROLLED_BACK | SUPERSEDED
 * Non-terminal (adoptable past age): everything else.
 */
export const TERMINAL_DEPLOYMENT_STATUSES = [
  "COMPLETED",
  "FAILED",
  "ROLLED_BACK",
  "SUPERSEDED",
] as const

export const NON_TERMINAL_DEPLOYMENT_STATUSES = [
  "PENDING",
  "GENERATING",
  "PROVISIONING",
  "CONFIGURING",
  "STARTING",
  "HEALTH_CHECK",
  "WAITING_CHANNELS",
] as const

export type NonTerminalDeploymentStatus =
  (typeof NON_TERMINAL_DEPLOYMENT_STATUSES)[number]

/** Honest per-phase error — mutation: drop HEALTH_CHECK from NON_TERMINAL → fail. */
export function strandedDeployErrorMessage(status: string): string {
  return `Deployment stranded: stuck in ${status} beyond max age — marked FAILED for retry`
}

/** @deprecated Prefer strandedDeployErrorMessage(phase). Kept for older call sites. */
export const STRANDED_DEPLOY_ERROR = strandedDeployErrorMessage("GENERATING/PROVISIONING")

/**
 * Resolve workspace status after a stranded deploy is adopted.
 * Wake / already-hibernated → HIBERNATED (retriable). Fresh DEPLOYING →
 * STOPPED if a prior container existed, else DRAFT.
 */
export function resolvePreDeployWorkspaceStatus(args: {
  workspaceStatus: string
  containerPhase: string | null | undefined
  hadContainerId: boolean
}): { status: "HIBERNATED" | "STOPPED" | "DRAFT"; containerPhase: "HIBERNATED" | "STOPPED" } {
  if (
    args.workspaceStatus === "WAKING" ||
    args.containerPhase === "WAKING" ||
    args.workspaceStatus === "HIBERNATED" ||
    args.containerPhase === "HIBERNATED"
  ) {
    return { status: "HIBERNATED", containerPhase: "HIBERNATED" }
  }
  if (args.hadContainerId) {
    return { status: "STOPPED", containerPhase: "STOPPED" }
  }
  return { status: "DRAFT", containerPhase: "STOPPED" }
}

export function isWakeOriginStrand(args: {
  workspaceStatus: string
  containerPhase: string | null | undefined
}): boolean {
  return (
    args.workspaceStatus === "WAKING" ||
    args.containerPhase === "WAKING" ||
    args.workspaceStatus === "HIBERNATED" ||
    args.containerPhase === "HIBERNATED"
  )
}

/**
 * Lifecycle P4.1 watchdog: adopt deployments stuck in ANY non-terminal
 * phase beyond STRANDED_DEPLOY_MAX_AGE_MIN. Marks Deployment FAILED with a
 * per-phase error, converges workspace to a retriable status, and re-arms
 * nextHeartbeatAt for wake-origin strands so the schedule survives the crash.
 */
export async function adoptStrandedDeployments(
  nowMs: number = Date.now(),
): Promise<{ adopted: number; errors: string[] }> {
  const cutoff = new Date(nowMs - strandedDeployMaxAgeMs())
  const stranded = await prisma.deployment.findMany({
    where: {
      status: { in: [...NON_TERMINAL_DEPLOYMENT_STATUSES] },
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
          containerState: {
            select: {
              containerPhase: true,
              heartbeatCronExpressions: true,
              heartbeatInterval: true,
            },
          },
        },
      },
    },
    take: 50,
  })

  let adopted = 0
  const errors: string[] = []
  const now = new Date(nowMs)

  for (const dep of stranded) {
    try {
      const restored = resolvePreDeployWorkspaceStatus({
        workspaceStatus: dep.workspace.status,
        containerPhase: dep.workspace.containerState?.containerPhase,
        hadContainerId: Boolean(dep.workspace.containerId),
      })

      const wakeOrigin = isWakeOriginStrand({
        workspaceStatus: dep.workspace.status,
        containerPhase: dep.workspace.containerState?.containerPhase,
      })

      const rearmedHint = wakeOrigin
        ? computeNextHeartbeatAt({
            now,
            heartbeatCronExpressions:
              dep.workspace.containerState?.heartbeatCronExpressions,
            heartbeatIntervalMs: dep.workspace.containerState?.heartbeatInterval,
          })
        : undefined

      await prisma.$transaction([
        prisma.deployment.update({
          where: { id: dep.id },
          data: {
            status: "FAILED",
            errorMessage: strandedDeployErrorMessage(dep.status),
            completedAt: now,
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
            ...(rearmedHint ? { nextHeartbeatAt: rearmedHint } : {}),
          },
        }),
      ])

      adopted++
      log.warn("stranded-adopter: adopted stuck deployment", {
        deploymentId: dep.id,
        workspaceId: dep.workspaceId,
        priorDeployStatus: dep.status,
        restoredWorkspaceStatus: restored.status,
        wakeOrigin,
        rearmedNextHeartbeatAt: rearmedHint ? rearmedHint.toISOString() : null,
        startedAt: dep.startedAt.toISOString(),
      })
    } catch (err) {
      errors.push(`${dep.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { adopted, errors }
}
