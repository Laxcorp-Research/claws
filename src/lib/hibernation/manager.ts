import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { deployToCloud, stopContainer } from "@/lib/openclaw/deployer"

export async function hibernateWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { containerState: true },
  })

  if (!workspace) {
    log.warn("Cannot hibernate: workspace not found", { workspaceId })
    return
  }

  if (!workspace.containerId) {
    log.warn("Cannot hibernate: no container/service ID", { workspaceId })
    return
  }

  const stateAge = workspace.containerState?.runtimeStateUpdatedAt
    ? Date.now() - workspace.containerState.runtimeStateUpdatedAt.getTime()
    : Infinity

  if (stateAge > 10 * 60 * 1000) {
    log.warn("Runtime state snapshot is stale, hibernating anyway", {
      workspaceId,
      stateAgeMinutes: Math.round(stateAge / 60000),
    })
  }

  try {
    await stopContainer(workspaceId)

    await prisma.$transaction([
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          containerPhase: "HIBERNATED",
          hibernatedAt: new Date(),
        },
      }),
      prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "HIBERNATED",
          containerId: null,
          containerPort: null,
          hostPort: null,
        },
      }),
    ])

    log.info("Workspace hibernated", {
      workspaceId,
      hasStateSnapshot: !!workspace.containerState?.runtimeStateSnapshot,
      stateAgeMinutes: stateAge === Infinity ? null : Math.round(stateAge / 60000),
    })
  } catch (err) {
    log.error("Hibernate failed", { workspaceId, error: String(err) })
  }
}

export async function wakeWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { containerState: true },
  })

  if (!workspace) {
    log.warn("Cannot wake: workspace not found", { workspaceId })
    return
  }

  if (workspace.status !== "HIBERNATED" && workspace.status !== "WAKING") {
    log.warn("Cannot wake: wrong status", { workspaceId, status: workspace.status })
    return
  }

  const wakeStart = Date.now()

  try {
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspaceId },
        data: { status: "WAKING" },
      }),
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          containerPhase: "WAKING",
          wakeRequestedAt: new Date(),
        },
      }),
    ])

    await deployToCloud(workspaceId)

    const wakeDuration = Date.now() - wakeStart
    const existingState = await prisma.containerState.findUnique({
      where: { workspaceId },
    })

    await prisma.containerState.update({
      where: { workspaceId },
      data: {
        lastWakeDurationMs: wakeDuration,
        avgWakeDurationMs: existingState?.avgWakeDurationMs
          ? Math.round(existingState.avgWakeDurationMs * 0.7 + wakeDuration * 0.3)
          : wakeDuration,
        hibernatedAt: null,
        wakeRequestedAt: null,
        lastActiveAt: new Date(),
      },
    })

    log.info("Workspace woke", {
      workspaceId,
      wakeDurationMs: wakeDuration,
      hadStateSnapshot: !!workspace.containerState?.runtimeStateSnapshot,
    })
  } catch (err) {
    log.error("Wake failed", { workspaceId, error: String(err) })

    await prisma
      .$transaction([
        prisma.workspace.update({
          where: { id: workspaceId },
          data: { status: "HIBERNATED" },
        }),
        prisma.containerState.update({
          where: { workspaceId },
          data: { containerPhase: "HIBERNATED", wakeRequestedAt: null },
        }),
      ])
      .catch(() => {})
  }
}
