import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { syncThenDestroy, destroyContainer } from "@/lib/openclaw/deployer"
import {
  decideTrialExpiryActions,
  isTrialStopEnforceableStatus,
  shouldSkipTrialStop,
  TRIAL_EXPIRY_GRACE_MS,
  trialStopEnforceMode,
  type TrialExpiryUser,
} from "@/lib/trial/decide-trial-expiry"
import {
  onHoldCapDue,
  TRIAL_WINBACK_AFTER_MS,
  trialWinbackDue,
} from "@/lib/trial/lifecycle-followups"
import {
  sendOnHoldCapEmail,
  sendTrialExpiryNotifyEmail,
  sendTrialExpiryStoppedEmail,
  sendTrialWinbackEmail,
} from "@/lib/trial/trial-expiry-emails"

export const maxDuration = 55

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const now = new Date()

  // Broad candidate set: expired trial, no active sub. Both notify and stop
  // phases are decided in pure logic (incl. on_hold skip + grace window).
  const users: TrialExpiryUser[] = await prisma.user.findMany({
    where: {
      trialUsed: true,
      OR: [{ trialEndsAt: { lt: now } }, { trialEndsAt: null }],
      hasActiveSubscription: false,
    },
    select: {
      id: true,
      email: true,
      name: true,
      trialUsed: true,
      trialEndsAt: true,
      trialExpiryNotifiedAt: true,
      hasActiveSubscription: true,
      subscriptionStatus: true,
      workspaces: {
        select: { id: true, name: true, status: true },
      },
    },
  })

  const plan = decideTrialExpiryActions(users, now, TRIAL_EXPIRY_GRACE_MS)

  if (dryRun) {
    log.info("Trial-expiry cron (dry run)", {
      candidatesScanned: users.length,
      wouldNotify: plan.toNotify.length,
      wouldStop: plan.toStop.length,
    })
    return Response.json({
      success: true,
      data: {
        dryRun: true,
        candidatesScanned: users.length,
        plan,
      },
    })
  }

  let notified = 0
  let stopped = 0
  let skipped = 0
  let errors = 0

  for (const action of plan.toNotify) {
    try {
      // Idempotency: re-read marker; skip if another tick already stamped.
      const fresh = await prisma.user.findUnique({
        where: { id: action.userId },
        select: {
          trialExpiryNotifiedAt: true,
          hasActiveSubscription: true,
          subscriptionStatus: true,
        },
      })
      if (!fresh) continue
      if (fresh.hasActiveSubscription || fresh.subscriptionStatus === "on_hold") {
        skipped++
        continue
      }
      if (fresh.trialExpiryNotifiedAt !== null) {
        skipped++
        continue
      }

      const emailResult = await sendTrialExpiryNotifyEmail({
        to: action.email,
        name: action.name,
        clawNames: action.clawNames,
        workspaceIds: action.workspaceIds,
      })
      // RESEND HONESTY: the SDK resolves { error } instead of throwing, so
      // the old await could "succeed" for a dead email and the stamp below
      // silenced the warning forever. Only stamp on a confirmed send.
      if (!emailResult.ok) {
        errors++
        log.error("Trial-expiry cron: notify email failed - retrying next tick", {
          userId: action.userId,
          reason: emailResult.reason,
        })
        continue
      }

      // Stamp AFTER successful send so a Resend failure retries next hour.
      await prisma.user.update({
        where: { id: action.userId },
        data: { trialExpiryNotifiedAt: now },
      })

      // Ledger notify phase (stop already ledgers trial_expiry_stop).
      for (const workspaceId of action.workspaceIds) {
        try {
          await prisma.activityLog.create({
            data: {
              workspaceId,
              action: "Trial expiry notify",
              detail:
                "Trial expiry notification emailed - containers keep running for 24h grace.",
              actionType: "SYSTEM",
              timestamp: now,
              metadata: JSON.stringify({
                eventKind: "trial_expiry_notify",
                userId: action.userId,
                email: action.email,
              }),
            },
          })
        } catch (ledgerErr) {
          log.error("Trial-expiry cron: notify ledger failed", {
            userId: action.userId,
            workspaceId,
            error: String(ledgerErr),
          })
        }
      }
      notified++
    } catch (err) {
      errors++
      log.error("Trial-expiry cron: notify failed", {
        userId: action.userId,
        error: String(err),
      })
    }
  }

  // Group stops by user for one stopped-email per user.
  const stopsByUser = new Map<
    string,
    { email: string; name: string | null; items: typeof plan.toStop }
  >()
  for (const action of plan.toStop) {
    const existing = stopsByUser.get(action.userId)
    if (existing) {
      existing.items.push(action)
    } else {
      stopsByUser.set(action.userId, {
        email: action.email,
        name: action.name,
        items: [action],
      })
    }
  }

  for (const [userId, group] of stopsByUser) {
    try {
      // Pre-stop re-check - MUTATION: remove → on_hold / resubscribe races stop.
      const fresh = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          hasActiveSubscription: true,
          subscriptionStatus: true,
          trialExpiryNotifiedAt: true,
        },
      })
      if (!fresh || shouldSkipTrialStop(fresh)) {
        skipped += group.items.length
        log.info("Skipping trial-expiry stop (subscribed or on_hold)", {
          userId,
          hasActiveSubscription: fresh?.hasActiveSubscription ?? null,
          subscriptionStatus: fresh?.subscriptionStatus ?? null,
        })
        continue
      }

      const stoppedNames: string[] = []
      const stoppedIds: string[] = []
      for (const action of group.items) {
        try {
          if (action.enforceMode === "status_flip") {
            // HIBERNATED: no live replica. HWD still leaves an empty Railway
            // service - trial termination must serviceDelete to release the slot.
            await destroyContainer(action.workspaceId)
            await prisma.$transaction([
              prisma.workspace.update({
                where: { id: action.workspaceId },
                data: { status: "STOPPED" },
              }),
              prisma.containerState.updateMany({
                where: { workspaceId: action.workspaceId },
                data: {
                  containerPhase: "STOPPED",
                  hibernatedAt: null,
                  wakeRequestedAt: null,
                  nextHeartbeatAt: null,
                },
              }),
              prisma.provisioningQueue.deleteMany({
                where: { workspaceId: action.workspaceId },
              }),
            ])
          } else {
            // RUNNING / WAKING / PAUSED / ERROR / DEPLOYING - tear down container.
            // Trial termination: serviceDelete is correct (syncThenDestroy).
            // syncThenDestroy → destroyContainer already writes STOPPED.
            // Do NOT rewrite to HIBERNATED (that re-opened the wake hole).
            await syncThenDestroy(action.workspaceId)
            await prisma.containerState.updateMany({
              where: { workspaceId: action.workspaceId },
              data: { nextHeartbeatAt: null, wakeRequestedAt: null },
            })
          }

          await prisma.activityLog.create({
            data: {
              workspaceId: action.workspaceId,
              action: "Trial expiry stop",
              detail:
                "Stopped after trial grace (24h past expiry notification). Subscribe to redeploy.",
              actionType: "SYSTEM",
              timestamp: now,
              metadata: JSON.stringify({
                eventKind: "trial_expiry_stop",
                userId,
                enforceMode: action.enforceMode,
                trialExpiryNotifiedAt: fresh.trialExpiryNotifiedAt?.toISOString() ?? null,
              }),
            },
          })

          stoppedNames.push(action.workspaceName)
          stoppedIds.push(action.workspaceId)
          stopped++
        } catch (err) {
          errors++
          log.error("Trial-expiry cron: stop failed", {
            userId,
            workspaceId: action.workspaceId,
            error: String(err),
          })
        }
      }

      if (stoppedNames.length > 0) {
        // Critical send (retry + owner-Telegram escalation live in the
        // wrapper); the typed result is counted here so the cron summary
        // stays honest.
        const stopEmailResult = await sendTrialExpiryStoppedEmail({
          to: group.email,
          name: group.name,
          stoppedNames,
          workspaceIds: stoppedIds,
        })
        if (!stopEmailResult.ok) {
          errors++
          log.error("Trial-expiry cron: stopped email failed", {
            userId,
            reason: stopEmailResult.reason,
          })
        }
      }
    } catch (err) {
      errors++
      log.error("Trial-expiry cron: stop group failed", {
        userId,
        error: String(err),
      })
    }
  }

  const onHoldStopped = await enforceOnHoldCap(now)
  const winbacks = await sendDueWinbacks(now)
  errors += onHoldStopped.errors + winbacks.errors

  log.info("Trial-expiry cron complete", {
    candidatesScanned: users.length,
    notified,
    stopped,
    skipped,
    errors,
    onHoldStopped: onHoldStopped.stopped,
    winbacks: winbacks.sent,
  })

  return Response.json({
    success: true,
    data: {
      candidatesScanned: users.length,
      notified,
      stopped,
      skipped,
      errors,
      onHoldStopped: onHoldStopped.stopped,
      winbacks: winbacks.sent,
    },
  })
}

async function enforceOnHoldCap(now: Date): Promise<{ stopped: number; errors: number }> {
  let stopped = 0
  let errors = 0
  const users = await prisma.user.findMany({
    where: { subscriptionStatus: "on_hold" },
    select: {
      id: true,
      email: true,
      name: true,
      subscriptionOnHoldAt: true,
      workspaces: { select: { id: true, name: true, status: true } },
    },
  })

  for (const user of users) {
    let since = user.subscriptionOnHoldAt
    if (!since) {
      const first = await prisma.activityLog.findFirst({
        where: {
          action: "Nudge: subscription-on-hold",
          workspace: { userId: user.id },
        },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true },
      })
      since = first?.timestamp ?? now
      await prisma.user.update({
        where: { id: user.id },
        data: { subscriptionOnHoldAt: since },
      })
    }
    if (!onHoldCapDue(since, now)) continue

    const stoppedNames: string[] = []
    const stoppedIds: string[] = []
    for (const workspace of user.workspaces) {
      if (!isTrialStopEnforceableStatus(workspace.status)) continue
      try {
        const mode = trialStopEnforceMode(workspace.status)
        if (mode === "status_flip") {
          await destroyContainer(workspace.id)
          await prisma.workspace.update({
            where: { id: workspace.id },
            data: { status: "STOPPED" },
          })
        } else {
          await syncThenDestroy(workspace.id)
        }
        stoppedNames.push(workspace.name)
        stoppedIds.push(workspace.id)
        stopped++
      } catch (err) {
        errors++
        log.error("on_hold cap stop failed", {
          userId: user.id,
          workspaceId: workspace.id,
          error: String(err),
        })
      }
    }
    if (stoppedNames.length === 0) continue
    const email = await sendOnHoldCapEmail({
      to: user.email,
      name: user.name,
      clawNames: stoppedNames,
      workspaceIds: stoppedIds,
    })
    if (!email.ok) errors++
  }
  return { stopped, errors }
}

async function sendDueWinbacks(now: Date): Promise<{ sent: number; errors: number }> {
  let sent = 0
  let errors = 0
  const cutoff = new Date(now.getTime() - TRIAL_WINBACK_AFTER_MS)
  const users = await prisma.user.findMany({
    where: {
      trialUsed: true,
      trialWinbackSentAt: null,
      hasActiveSubscription: false,
      trialEndsAt: { lt: cutoff },
      OR: [{ subscriptionStatus: null }, { subscriptionStatus: { not: "on_hold" } }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      trialEndsAt: true,
      trialUsed: true,
      trialWinbackSentAt: true,
      hasActiveSubscription: true,
      subscriptionStatus: true,
      workspaces: { select: { id: true, name: true } },
    },
  })
  for (const user of users) {
    if (!trialWinbackDue({ ...user, now })) continue
    try {
      const result = await sendTrialWinbackEmail({
        to: user.email,
        name: user.name,
        clawNames: user.workspaces.map((w) => w.name),
        workspaceIds: user.workspaces.map((w) => w.id),
      })
      if (!result.ok) {
        errors++
        continue
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { trialWinbackSentAt: now },
      })
      sent++
    } catch (err) {
      errors++
      log.error("trial win-back failed", { userId: user.id, error: String(err) })
    }
  }
  return { sent, errors }
}
