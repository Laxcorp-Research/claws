import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { deployToCloud, syncThenDestroy, type SyncThenDestroyOptions } from "@/lib/openclaw/deployer"
import { computeNextHeartbeatAt } from "@/lib/hibernation/next-heartbeat"
import { HIBERNATION_REFUSED_ACTION } from "@/lib/hibernation/stale-destroy"

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

export type HibernateResult =
  | { hibernated: true }
  | { hibernated: false; refused: true; reason: string }

export async function hibernateWorkspace(
  workspaceId: string,
  // PR-2: forwarded to syncThenDestroy. The hibernation cron passes a tighter
  // syncTimeoutMs (10s, matching the container SIGTERM window) and sets
  // skipSync when it's low on its 55s ceiling (budget guard).
  // Lifecycle P3: destroyPolicy is forced to refuse-unsafe — auto-hibernate
  // NEVER destroys unsynced/stale state (skipSync → refuse, not bare destroy).
  syncOpts: SyncThenDestroyOptions = {},
): Promise<HibernateResult> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { containerState: true },
  })

  if (!workspace) {
    log.warn("Cannot hibernate: workspace not found", { workspaceId })
    return { hibernated: false, refused: true, reason: "workspace-not-found" }
  }

  if (!workspace.containerId) {
    log.warn("Cannot hibernate: no container/service ID", { workspaceId })
    return { hibernated: false, refused: true, reason: "no-container" }
  }

  try {
    // Lifecycle P3: refuse-unsafe — sync fail / stale / skipSync keeps RUNNING/WARM.
    const teardown = await syncThenDestroy(workspaceId, {
      ...syncOpts,
      destroyPolicy: "refuse-unsafe",
    })

    if (!teardown.destroyed) {
      const reason = teardown.reason
      log.warn("Hibernation refused: state not safely synced", { workspaceId, reason })
      try {
        await prisma.activityLog.create({
          data: {
            workspaceId,
            action: HIBERNATION_REFUSED_ACTION,
            detail: `Auto-hibernate refused (${reason}). Container kept RUNNING/WARM.`,
            actionType: "ERROR",
            timestamp: new Date(),
            metadata: JSON.stringify({
              eventKind: "hibernation_refused",
              reason,
            }),
          },
        })
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { hibernationRefusedAt: new Date() },
        })
      } catch (markErr) {
        log.error("Failed to record hibernation refusal", {
          workspaceId,
          error: String(markErr),
        })
      }
      return { hibernated: false, refused: true, reason }
    }

    // Lifecycle P2: recompute wake hint at hibernate.
    const hibernatedAt = new Date()
    let heartbeatIntervalMs = workspace.containerState?.heartbeatInterval ?? null
    if (heartbeatIntervalMs == null) {
      const orch = await prisma.agent.findFirst({
        where: { workspaceId, role: "ORCHESTRATOR" },
        select: { heartbeatFrequency: true },
      })
      heartbeatIntervalMs = intervalMsFromFrequency(orch?.heartbeatFrequency)
      if (heartbeatIntervalMs != null) {
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

    const stateAge = workspace.containerState?.runtimeStateUpdatedAt
      ? Date.now() - workspace.containerState.runtimeStateUpdatedAt.getTime()
      : Infinity

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
          hibernationRefusedAt: null,
        },
      }),
    ])

    // P5: arm Telegram wake-on-channel webhook so inbound isn't a dead-drop.
    try {
      const { armTelegramWakeWebhook } = await import("@/lib/hibernation/wake-on-channel")
      await armTelegramWakeWebhook(workspaceId)
    } catch (armErr) {
      log.warn("Hibernate: telegram wake webhook arm failed", {
        workspaceId,
        error: armErr instanceof Error ? armErr.message : String(armErr),
      })
    }

    log.info("Workspace hibernated", {
      workspaceId,
      hasStateSnapshot: !!workspace.containerState?.runtimeStateSnapshot,
      stateAgeMinutes: stateAge === Infinity ? null : Math.round(stateAge / 60000),
    })
    return { hibernated: true }
  } catch (err) {
    log.error("Hibernate failed", { workspaceId, error: String(err) })
    return { hibernated: false, refused: true, reason: "hibernate-error" }
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
