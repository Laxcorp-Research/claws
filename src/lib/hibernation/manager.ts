import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { deployToCloud, syncThenDestroy, type SyncThenDestroyOptions } from "@/lib/openclaw/deployer"
import { computeNextHeartbeatAt } from "@/lib/hibernation/next-heartbeat"

function intervalMsFromFrequency(frequency: string | null | undefined): number | null {
  switch (frequency) {
    case "hourly":
      return 60 * 60 * 1000
    case "every_6h":
      return 6 * 60 * 60 * 1000
    case "every_12h":
      return 12 * 60 * 60 * 1000
    default:
      return null
  }
}

export async function hibernateWorkspace(
  workspaceId: string,
  // PR-2: forwarded to syncThenDestroy. The hibernation cron passes a tighter
  // syncTimeoutMs (10s, matching the container SIGTERM window) and sets
  // skipSync when it's low on its 55s ceiling (budget guard).
  syncOpts: SyncThenDestroyOptions = {},
): Promise<void> {
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
    // PR-2: confirmed pre-destroy sync (10s budget on the cron path; skipSync
    // when the cron is low on its 55s ceiling). syncThenDestroy never throws on
    // a sync failure — it records an incomplete-sync marker and destroys anyway,
    // so hibernation is never blocked by a slow/unreachable container.
    await syncThenDestroy(workspaceId, syncOpts)

    // Lifecycle P2: recompute wake hint at hibernate so cron claws keep a
    // next fire and interval claws finally get now+interval (auto-wake).
    // Pre-P2 rows may lack heartbeatInterval — derive from orchestrator frequency.
    const hibernatedAt = new Date()
    let heartbeatIntervalMs = workspace.containerState?.heartbeatInterval ?? null
    if (heartbeatIntervalMs == null) {
      const orch = await prisma.agent.findFirst({
        where: { workspaceId, role: "ORCHESTRATOR" },
        select: { heartbeatFrequency: true },
      })
      heartbeatIntervalMs = intervalMsFromFrequency(orch?.heartbeatFrequency)
      if (heartbeatIntervalMs != null) {
        // Persist so subsequent rolls don't re-derive.
        await prisma.containerState.update({
          where: { workspaceId },
          data: { heartbeatInterval: heartbeatIntervalMs },
        })
      }
    }
    const nextHeartbeatAt = computeNextHeartbeatAt({
      now: hibernatedAt,
      heartbeatCronExpressions: workspace.containerState?.heartbeatCronExpressions,
      heartbeatIntervalMs,
    })

    await prisma.$transaction([
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          containerPhase: "HIBERNATED",
          hibernatedAt,
          nextHeartbeatAt,
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
