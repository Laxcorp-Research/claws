import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import {
  runningIdleWhere,
  warmIdleWhere,
  wakeHibernatedWhere,
} from "@/lib/hibernation/predicates"
import { isWakeEligible } from "@/lib/hibernation/wake-geometry"

function verifyAgentSecret(req: NextRequest): boolean {
  const auth = req.headers.get("Authorization")
  return auth === `Bearer ${process.env.CONTAINER_AGENT_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!verifyAgentSecret(req)) {
    return apiError("UNAUTHORIZED", "Invalid agent secret", 401)
  }

  const now = new Date()

  const runningCandidates = await prisma.containerState.findMany({
    where: runningIdleWhere(now),
    include: { workspace: { select: { id: true, containerId: true, status: true } } },
  })

  const warmCandidates = await prisma.containerState.findMany({
    where: warmIdleWhere(now),
    include: { workspace: { select: { id: true, containerId: true, status: true } } },
  })

  const toHibernate = [...runningCandidates, ...warmCandidates]
    .filter((s) => s.workspace.containerId)
    .map((s) => ({
      workspaceId: s.workspaceId,
      containerId: s.workspace.containerId!,
    }))

  // P2.3: same where + isWakeEligible helper as /api/cron/hibernation.
  // MUTATION: restoring upper-cutoff gt-now / inline 2m avg*2 clamp → dual-path drift.
  const wakeCandidates = await prisma.containerState.findMany({
    where: wakeHibernatedWhere(),
    include: { workspace: { select: { id: true } } },
  })

  const toWake = wakeCandidates
    .filter((s) => {
      const hint = s.nextHeartbeatAt
      if (!hint) return false
      return isWakeEligible({
        now,
        nextHeartbeatAt: hint,
        avgWakeDurationMs: s.avgWakeDurationMs,
      })
    })
    .map((s) => ({
      workspaceId: s.workspaceId,
      savedContainerConfig: s.savedContainerConfig,
    }))

  return apiSuccess({ toHibernate, toWake })
}
