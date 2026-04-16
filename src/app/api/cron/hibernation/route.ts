import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { hibernateWorkspace, wakeWorkspace } from "@/lib/hibernation/manager"

export const maxDuration = 55

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (process.env.HIBERNATION_ENABLED === "false") {
    return Response.json({ success: true, data: { skipped: true } })
  }

  const now = new Date()
  let hibernated = 0
  let woke = 0
  let errors = 0

  // ─── HIBERNATE CANDIDATES ────────────────────────────

  const idleCutoff = new Date(now.getTime() - 10 * 60 * 1000)
  const futureWindow = new Date(now.getTime() + 15 * 60 * 1000)
  const channelIdleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const runningIdle = await prisma.containerState.findMany({
    where: {
      containerPhase: "RUNNING",
      hasActiveChannels: false,
      lastActiveAt: { lt: idleCutoff },
      OR: [{ nextHeartbeatAt: null }, { nextHeartbeatAt: { gt: futureWindow } }],
    },
    include: { workspace: { select: { id: true, containerId: true } } },
  })

  const warmIdle = await prisma.containerState.findMany({
    where: {
      containerPhase: "WARM",
      OR: [{ lastChannelMessageAt: { lt: channelIdleCutoff } }, { lastChannelMessageAt: null }],
      AND: {
        OR: [{ nextHeartbeatAt: null }, { nextHeartbeatAt: { gt: futureWindow } }],
      },
    },
    include: { workspace: { select: { id: true, containerId: true } } },
  })

  const hibernateCandidates = [...runningIdle, ...warmIdle].filter(
    (s) => s.workspace.containerId,
  )

  for (const candidate of hibernateCandidates) {
    try {
      await hibernateWorkspace(candidate.workspaceId)
      hibernated++
    } catch (err) {
      errors++
      log.error("Hibernation cron: hibernate failed", {
        workspaceId: candidate.workspaceId,
        error: String(err),
      })
    }
  }

  // ─── WAKE CANDIDATES ─────────────────────────────────

  const maxLookAhead = new Date(now.getTime() + 10 * 60 * 1000)

  const wakeCandidates = await prisma.containerState.findMany({
    where: {
      containerPhase: "HIBERNATED",
      nextHeartbeatAt: { lte: maxLookAhead, gt: now },
    },
    select: {
      workspaceId: true,
      nextHeartbeatAt: true,
      avgWakeDurationMs: true,
    },
  })

  for (const candidate of wakeCandidates) {
    const leadTime = candidate.avgWakeDurationMs
      ? Math.min(600_000, Math.max(120_000, candidate.avgWakeDurationMs * 2))
      : 5 * 60 * 1000

    const wakeDeadline = new Date(candidate.nextHeartbeatAt!.getTime() - leadTime)

    if (now >= wakeDeadline) {
      try {
        await wakeWorkspace(candidate.workspaceId)
        woke++
      } catch (err) {
        errors++
        log.error("Hibernation cron: wake failed", {
          workspaceId: candidate.workspaceId,
          error: String(err),
        })
      }
    }
  }

  // ─── STUCK WAKING RECOVERY ───────────────────────────

  const stuckThreshold = new Date(now.getTime() - 5 * 60 * 1000)
  const stuckWaking = await prisma.containerState.findMany({
    where: {
      containerPhase: "WAKING",
      wakeRequestedAt: { lt: stuckThreshold },
    },
    select: { workspaceId: true },
  })

  for (const stuck of stuckWaking) {
    try {
      log.warn("Retrying stuck wake", { workspaceId: stuck.workspaceId })
      await wakeWorkspace(stuck.workspaceId)
      woke++
    } catch {
      errors++
      await prisma
        .$transaction([
          prisma.workspace.update({
            where: { id: stuck.workspaceId },
            data: { status: "HIBERNATED" },
          }),
          prisma.containerState.update({
            where: { workspaceId: stuck.workspaceId },
            data: { containerPhase: "HIBERNATED", wakeRequestedAt: null },
          }),
        ])
        .catch(() => {})
    }
  }

  log.info("Hibernation cron complete", {
    hibernated,
    woke,
    errors,
    stuckRetried: stuckWaking.length,
  })

  return Response.json({ success: true, data: { hibernated, woke, errors } })
}
