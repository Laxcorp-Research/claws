import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { supersedePriorDeployments } from "@/lib/deploy/supersede-deployments"
import { deployToCloud, syncThenRemoveDeployment, type SyncThenDestroyOptions } from "@/lib/openclaw/deployer"
import { computeNextHeartbeatAt } from "@/lib/hibernation/next-heartbeat"
import { isPastDueHint } from "@/lib/hibernation/wake-geometry"
import { HIBERNATION_REFUSED_ACTION } from "@/lib/hibernation/stale-destroy"
import { canWakeHibernatedWorkspace } from "@/lib/trial/wake-entitlement"
import { maybeResumeInterruptedMission } from "@/lib/healing/mission-resume"

// P2.3 / -10 overlay (NOT built here): catch-up-beat-on-boot - when a claw
// wakes past a due heartbeat hint, the container overlay should fire one
// immediate HEARTBEAT poll after boot so the missed wall-clock beat is not
// only "honest-miss + rolled" on the platform. File against openclaw-runtime
// -10; platform late-wake semantics below only set heartbeatMissedAt + roll.

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
  // PR-2: forwarded to syncThenRemoveDeployment. The hibernation cron passes a tighter
  // syncTimeoutMs (10s, matching the container SIGTERM window) and sets
  // skipSync when it's low on its 55s ceiling (budget guard).
  // Lifecycle P3: destroyPolicy is forced to refuse-unsafe - auto-hibernate
  // NEVER tears down unsynced/stale state (skipSync → refuse, not bare remove).
  // HWD: NEVER serviceDelete on this path - deploymentRemove only.
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
    // Lifecycle P3: refuse-unsafe - sync fail / stale / skipSync keeps RUNNING/WARM.
    const teardown = await syncThenRemoveDeployment(workspaceId, {
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

    // HWD: containerId/containerHost persist (service kept). Do not null them.
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
          containerPort: null,
          hostPort: null,
          hibernationRefusedAt: null,
        },
      }),
    ])

    // Lifecycle closure: hibernate retires the live COMPLETED Deployment row.
    // Wake mints a new row via deployToCloud; without this, COMPLETED zombies
    // accumulate across hibernate/wake and inflate force-update fanout.
    await supersedePriorDeployments(workspaceId)

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

    // Digest sleepWakeCycles counts ActivityLog rows matching /Hibernat/i or
    // metadata hibernation - without this row, real naps show cycles=0.
    await prisma.activityLog.create({
      data: {
        workspaceId,
        actionType: "SYSTEM",
        action: "Workspace hibernated",
        detail: nextHeartbeatAt
          ? `nextHeartbeatAt=${nextHeartbeatAt.toISOString()}`
          : "nextHeartbeatAt=null",
        metadata: JSON.stringify({
          eventKind: "hibernation_complete",
          nextHeartbeatAt: nextHeartbeatAt?.toISOString() ?? null,
          hibernatedAt: hibernatedAt.toISOString(),
        }),
      },
    })

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

/** Failed wake must stay schedulable. STOPPED (trial destroy) is not a wake. */
export const WAKEABLE_WORKSPACE_STATUSES = ["HIBERNATED", "WAKING", "ERROR"] as const

export async function wakeWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      containerState: true,
      user: {
        select: {
          trialUsed: true,
          trialStartedAt: true,
          trialEndsAt: true,
          hasActiveSubscription: true,
        },
      },
    },
  })

  if (!workspace) {
    log.warn("Cannot wake: workspace not found", { workspaceId })
    return
  }

  if (!(WAKEABLE_WORKSPACE_STATUSES as readonly string[]).includes(workspace.status)) {
    log.warn("Cannot wake: wrong status", { workspaceId, status: workspace.status })
    return
  }

  // Defense in depth: every wake path must refuse expired+unsubscribed claws.
  // Fail closed when owner row is missing from the join.
  const entitlement = workspace.user
    ? canWakeHibernatedWorkspace(workspace.user)
    : { allowed: false as const, reason: "owner_missing", needsSubscription: true }
  if (!entitlement.allowed) {
    log.warn("Cannot wake: entitlement denied", {
      workspaceId,
      reason: entitlement.reason,
    })
    // Terminalize so scheduled wake stops retrying a dead entitlement.
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspaceId },
        data: { status: "STOPPED" },
      }),
      prisma.containerState.updateMany({
        where: { workspaceId },
        data: {
          containerPhase: "STOPPED",
          hibernatedAt: null,
          wakeRequestedAt: null,
          nextHeartbeatAt: null,
        },
      }),
    ])
    return
  }

  const wakeStart = Date.now()
  const wakeRequestedAt = new Date()
  const hintAtWake = workspace.containerState?.nextHeartbeatAt ?? null
  const pastDue =
    hintAtWake !== null ? isPastDueHint(wakeRequestedAt, hintAtWake) : false

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
          wakeRequestedAt,
        },
      }),
    ])

    await deployToCloud(workspaceId, {
      forbidCreate: true,
      preserveHibernationOnFailure: true,
    })

    const wakeDuration = Date.now() - wakeStart
    const existingState = await prisma.containerState.findUnique({
      where: { workspaceId },
    })

    // P2.3 late-wake: past-due hint → honest miss + roll to next future fire
    // so the claw is never stranded on a hint that can no longer match `gt: now`.
    const rolledHint = pastDue
      ? computeNextHeartbeatAt({
          now: wakeRequestedAt,
          heartbeatCronExpressions: existingState?.heartbeatCronExpressions,
          heartbeatIntervalMs: existingState?.heartbeatInterval,
        })
      : undefined

    await prisma.$transaction([
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          lastWakeDurationMs: wakeDuration,
          avgWakeDurationMs: existingState?.avgWakeDurationMs
            ? Math.round(existingState.avgWakeDurationMs * 0.7 + wakeDuration * 0.3)
            : wakeDuration,
          hibernatedAt: null,
          wakeRequestedAt: null,
          lastActiveAt: new Date(),
          ...(rolledHint !== undefined ? { nextHeartbeatAt: rolledHint } : {}),
        },
      }),
      ...(pastDue
        ? [
            prisma.workspace.update({
              where: { id: workspaceId },
              data: { heartbeatMissedAt: wakeRequestedAt },
            }),
            prisma.activityLog.create({
              data: {
                workspaceId,
                action: "Heartbeat missed",
                detail: `Late wake: past-due nextHeartbeatAt=${hintAtWake!.toISOString()} wokeAt=${wakeRequestedAt.toISOString()}`,
                actionType: "ERROR",
                timestamp: wakeRequestedAt,
                metadata: JSON.stringify({
                  eventKind: "heartbeat_late_wake",
                  nextHeartbeatAt: hintAtWake!.toISOString(),
                  wokeAt: wakeRequestedAt.toISOString(),
                }),
              },
            }),
          ]
        : []),
    ])

    log.info("Workspace woke", {
      workspaceId,
      wakeDurationMs: wakeDuration,
      hadStateSnapshot: !!workspace.containerState?.runtimeStateSnapshot,
      lateWake: pastDue,
      rolledNextHeartbeatAt: rolledHint?.toISOString() ?? null,
    })

    // version-update applies here via deployToCloud (latest image). Mission
    // resume is silent unless it fails twice.
    await maybeResumeInterruptedMission(workspaceId)
    const { flushHeldChatSends } = await import("@/lib/openclaw/chat-send-hold")
    await flushHeldChatSends(workspaceId).catch((flushErr) => {
      log.warn("wake: held chat flush failed", {
        workspaceId,
        error: flushErr instanceof Error ? flushErr.message : String(flushErr),
      })
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
    throw err
  }
}
