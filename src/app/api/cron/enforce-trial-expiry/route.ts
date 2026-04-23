import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { stopContainer } from "@/lib/openclaw/deployer"
import {
  decideEnforcementActions,
  type UserWithWorkspaces,
} from "@/lib/trial/decide-enforcement"

export const maxDuration = 55

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "true"

  const now = new Date()

  const users: UserWithWorkspaces[] = await prisma.user.findMany({
    where: {
      trialUsed: true,
      trialEndsAt: { lt: now },
      hasActiveSubscription: false,
    },
    select: {
      id: true,
      trialUsed: true,
      trialEndsAt: true,
      hasActiveSubscription: true,
      workspaces: {
        where: { status: "RUNNING" },
        select: { id: true, status: true, containerId: true },
      },
    },
  })

  const plan = decideEnforcementActions(users, now)

  if (dryRun) {
    log.info("Trial-expiry cron (dry run)", {
      candidatesScanned: users.length,
      wouldStop: plan.toStop.length,
    })
    return Response.json({
      success: true,
      data: { dryRun: true, candidatesScanned: users.length, plan },
    })
  }

  let stopped = 0
  let errors = 0

  for (const action of plan.toStop) {
    try {
      // Re-read hasActiveSubscription right before the stop call to narrow
      // the race window against Dodo's subscription.active webhook. A user
      // who subscribes between the findMany above and this iteration should
      // NOT have their container stopped.
      const fresh = await prisma.user.findUnique({
        where: { id: action.userId },
        select: { hasActiveSubscription: true },
      })
      if (fresh?.hasActiveSubscription) {
        log.info("Skipping: subscription activated between planning and execution", {
          userId: action.userId,
          workspaceId: action.workspaceId,
        })
        continue
      }

      await stopContainer(action.workspaceId)
      stopped++
      log.info("Trial-expiry cron: stopped workspace", {
        userId: action.userId,
        workspaceId: action.workspaceId,
      })
    } catch (err) {
      errors++
      log.error("Trial-expiry cron: stop failed", {
        userId: action.userId,
        workspaceId: action.workspaceId,
        error: String(err),
      })
    }
  }

  log.info("Trial-expiry cron complete", {
    candidatesScanned: users.length,
    stopped,
    errors,
    dryRun: false,
  })

  return Response.json({
    success: true,
    data: { candidatesScanned: users.length, stopped, errors },
  })
}
