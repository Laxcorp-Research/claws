import { NextRequest, after } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { hibernateWorkspace, wakeWorkspace } from "@/lib/hibernation/manager"
import {
  runningIdleWhere,
  warmIdleWhere,
  wakeHibernatedWhere,
} from "@/lib/hibernation/predicates"
import {
  DEFAULT_HIBERNATION_CRON_CADENCE_MS,
  DEFAULT_WAKE_BUFFER_MS,
  DEFAULT_WAKE_MIN_LEAD_MS,
  describeWakeEligibility,
  isWakeEligible,
  type WakeEligibilityLine,
} from "@/lib/hibernation/wake-geometry"
import { canWakeHibernatedWorkspace } from "@/lib/trial/wake-entitlement"

// before: 55 — Vercel FUNCTION_INVOCATION_TIMEOUT when wakes awaited inline.
// after: 300 — belt for sleep-side syncThenDestroy + after() wake fan-out headroom.
export const maxDuration = 300

// Sleep side stays INLINE (budget-guarded). Each hibernate awaits syncThenDestroy
// with a 10s sync budget; skipSync flips near the function ceiling so a sync
// cannot be killed mid-write. Wakes (deployToCloud) are the long pole and run
// via after() per-workspace so the tick HTTP response returns in seconds.
const HIBERNATE_SYNC_TIMEOUT_MS = 10_000
const SYNC_DELETE_MARGIN_MS = 8_000
const SYNC_BUDGET_CUTOFF_MS =
  maxDuration * 1000 - HIBERNATE_SYNC_TIMEOUT_MS - SYNC_DELETE_MARGIN_MS

/**
 * Schedule one wake in after(); failures are logged per-workspace and never
 * reject sibling wakes. MUTATION: awaiting wakeWorkspace in the tick body →
 * duration / isolation tests fail.
 */
function scheduleWake(workspaceId: string, reason: "eligible" | "stuck"): void {
  after(async () => {
    try {
      await wakeWorkspace(workspaceId)
      log.info("Hibernation cron: wake completed (after)", { workspaceId, reason })
    } catch (err) {
      log.error("Hibernation cron: wake failed (after)", {
        workspaceId,
        reason,
        error: String(err),
      })
      if (reason === "stuck") {
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
  })
}

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

  // ─── HIBERNATE CANDIDATES (inline, budget-guarded) ───
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
    const skipSync = Date.now() - startedAt > SYNC_BUDGET_CUTOFF_MS
    if (skipSync) syncSkippedForBudget++
    try {
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

  // ─── WAKE CANDIDATES (P2.3 geometry) — decide inline, execute in after() ─

  const ownerEntitlementSelect = {
    workspace: {
      select: {
        user: {
          select: {
            trialUsed: true,
            trialStartedAt: true,
            trialEndsAt: true,
            hasActiveSubscription: true,
          },
        },
      },
    },
  } as const

  const wakeCandidates = await prisma.containerState.findMany({
    where: wakeHibernatedWhere(),
    select: {
      workspaceId: true,
      nextHeartbeatAt: true,
      avgWakeDurationMs: true,
      ...ownerEntitlementSelect,
    },
  })

  const wakeEligibility: WakeEligibilityLine[] = []
  let wakeSkippedEntitlement = 0

  for (const candidate of wakeCandidates) {
    const hint = candidate.nextHeartbeatAt
    if (!hint) continue

    const line = describeWakeEligibility({
      workspaceId: candidate.workspaceId,
      now,
      nextHeartbeatAt: hint,
      avgWakeDurationMs: candidate.avgWakeDurationMs,
    })
    wakeEligibility.push(line)
    log.info("Hibernation wake eligibility", line)

    if (
      !isWakeEligible({
        now,
        nextHeartbeatAt: hint,
        avgWakeDurationMs: candidate.avgWakeDurationMs,
      })
    ) {
      continue
    }

    const entitlement = canWakeHibernatedWorkspace(candidate.workspace.user)
    if (!entitlement.allowed) {
      wakeSkippedEntitlement++
      log.info("Hibernation cron: skip wake (entitlement denied)", {
        workspaceId: candidate.workspaceId,
        reason: entitlement.reason,
      })
      continue
    }

    // WAKE_AFTER_FANOUT_ASSERT — do not await wakeWorkspace here.
    scheduleWake(candidate.workspaceId, "eligible")
    woke++
  }

  // ─── STUCK WAKING RECOVERY (also after()) ────────────

  const stuckThreshold = new Date(now.getTime() - 5 * 60 * 1000)
  const stuckWaking = await prisma.containerState.findMany({
    where: {
      containerPhase: "WAKING",
      wakeRequestedAt: { lt: stuckThreshold },
    },
    select: {
      workspaceId: true,
      ...ownerEntitlementSelect,
    },
  })

  for (const stuck of stuckWaking) {
    const entitlement = canWakeHibernatedWorkspace(stuck.workspace.user)
    if (!entitlement.allowed) {
      wakeSkippedEntitlement++
      log.info("Hibernation cron: skip stuck wake (entitlement denied)", {
        workspaceId: stuck.workspaceId,
        reason: entitlement.reason,
      })
      continue
    }
    log.warn("Retrying stuck wake (scheduled after)", { workspaceId: stuck.workspaceId })
    scheduleWake(stuck.workspaceId, "stuck")
    woke++
  }

  const durationMs = Date.now() - startedAt
  log.info("Hibernation cron complete", {
    hibernated,
    woke,
    errors,
    stuckRetried: stuckWaking.length,
    wakeSkippedEntitlement,
    syncSkippedForBudget,
    wakeCandidatesConsidered: wakeEligibility.length,
    durationMs,
    wakeExecution: "after-fanout",
  })

  return Response.json({
    success: true,
    data: {
      hibernated,
      refused,
      woke,
      errors,
      syncSkippedForBudget,
      wakeEligibility,
      durationMs,
      wakeExecution: "after-fanout",
      wakeLead: {
        minLeadMs: DEFAULT_WAKE_MIN_LEAD_MS,
        cronCadenceMs: DEFAULT_HIBERNATION_CRON_CADENCE_MS,
        bufferMs: DEFAULT_WAKE_BUFFER_MS,
        env: {
          HIBERNATION_WAKE_MIN_LEAD_MS:
            process.env.HIBERNATION_WAKE_MIN_LEAD_MS ?? null,
          HIBERNATION_CRON_CADENCE_MS:
            process.env.HIBERNATION_CRON_CADENCE_MS ?? null,
          HIBERNATION_WAKE_BUFFER_MS:
            process.env.HIBERNATION_WAKE_BUFFER_MS ?? null,
        },
      },
    },
  })
}
