import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { hibernateWorkspace, wakeWorkspace } from "@/lib/hibernation/manager"
import { runningIdleWhere, warmIdleWhere } from "@/lib/hibernation/predicates"

export const maxDuration = 55

// PR-2 (syncThenDestroy budget guard): hibernate routes through
// syncThenDestroy, which adds a bounded pre-destroy /internal/sync-now call.
// On this cron we use a 10s sync budget (matches the container's SIGTERM sync
// window in process-manager.mjs). To avoid a sync being killed mid-write by
// the 55s function cap, we stop starting NEW syncs once too little of the
// budget remains and bare-destroy the rest (they get re-attempted with sync on
// the next 2-min pass). The margin covers the Railway deleteService + DB writes
// that follow each sync.
const HIBERNATE_SYNC_TIMEOUT_MS = 10_000
const SYNC_DELETE_MARGIN_MS = 8_000
const SYNC_BUDGET_CUTOFF_MS = maxDuration * 1000 - HIBERNATE_SYNC_TIMEOUT_MS - SYNC_DELETE_MARGIN_MS

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  if (process.env.HIBERNATION_ENABLED === "false") {
    return Response.json({ success: true, data: { skipped: true } })
  }

  const now = new Date()
  const startedAt = Date.now()
  let hibernated = 0
  let refused = 0
  let woke = 0
  let errors = 0
  let syncSkippedForBudget = 0

  // ─── HIBERNATE CANDIDATES ────────────────────────────
  // Predicates shared with /api/internal/hibernation/candidates (parity).

  const runningIdle = await prisma.containerState.findMany({
    where: runningIdleWhere(now),
    include: { workspace: { select: { id: true, containerId: true } } },
  })

  const warmIdle = await prisma.containerState.findMany({
    where: warmIdleWhere(now),
    include: { workspace: { select: { id: true, containerId: true } } },
  })

  const hibernateCandidates = [...runningIdle, ...warmIdle].filter(
    (s) => s.workspace.containerId,
  )

  for (const candidate of hibernateCandidates) {
    // Budget guard: once too little of the 55s ceiling remains, stop starting
    // new syncs and bare-destroy the rest (skipSync) so a sync can't be killed
    // mid-write. elapsed only grows, so this is monotonic.
    const skipSync = Date.now() - startedAt > SYNC_BUDGET_CUTOFF_MS
    if (skipSync) syncSkippedForBudget++
    try {
      // P3: skipSync under refuse-unsafe refuses (never bare-destroys).
      const result = await hibernateWorkspace(candidate.workspaceId, {
        syncTimeoutMs: HIBERNATE_SYNC_TIMEOUT_MS,
        skipSync,
      })
      if (result.hibernated) hibernated++
      else refused++
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
    syncSkippedForBudget,
  })

  return Response.json({
    success: true,
    data: { hibernated, refused, woke, errors, syncSkippedForBudget },
  })
}
