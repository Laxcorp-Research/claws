import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { syncThenDestroy } from "@/lib/openclaw/deployer"
import {
  decideTrialExpiryActions,
  shouldSkipTrialStop,
  TRIAL_EXPIRY_GRACE_MS,
  type TrialExpiryUser,
} from "@/lib/trial/decide-trial-expiry"
import {
  sendTrialExpiryNotifyEmail,
  sendTrialExpiryStoppedEmail,
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

      await sendTrialExpiryNotifyEmail({
        to: action.email,
        name: action.name,
        clawNames: action.clawNames,
      })

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
                "Trial expiry notification emailed — containers keep running for 24h grace.",
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
      // Pre-stop re-check — MUTATION: remove → on_hold / resubscribe races stop.
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
      for (const action of group.items) {
        try {
          // P3 lifecycle-safe path (exhaustion precedent). NOT bare destroyContainer.
          await syncThenDestroy(action.workspaceId)

          await prisma.$transaction([
            prisma.workspace.update({
              where: { id: action.workspaceId },
              data: { status: "HIBERNATED" },
            }),
            prisma.containerState.updateMany({
              where: { workspaceId: action.workspaceId },
              data: {
                containerPhase: "HIBERNATED",
                hibernatedAt: now,
                wakeRequestedAt: null,
              },
            }),
          ])

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
                trialExpiryNotifiedAt: fresh.trialExpiryNotifiedAt?.toISOString() ?? null,
              }),
            },
          })

          stoppedNames.push(action.workspaceName)
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
        try {
          await sendTrialExpiryStoppedEmail({
            to: group.email,
            name: group.name,
            stoppedNames,
          })
        } catch (err) {
          errors++
          log.error("Trial-expiry cron: stopped email failed", {
            userId,
            error: String(err),
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

  log.info("Trial-expiry cron complete", {
    candidatesScanned: users.length,
    notified,
    stopped,
    skipped,
    errors,
  })

  return Response.json({
    success: true,
    data: { candidatesScanned: users.length, notified, stopped, skipped, errors },
  })
}
