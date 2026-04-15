import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"

function verifyAgentSecret(req: NextRequest): boolean {
  const auth = req.headers.get("Authorization")
  return auth === `Bearer ${process.env.CONTAINER_AGENT_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!verifyAgentSecret(req)) {
    return apiError("UNAUTHORIZED", "Invalid agent secret", 401)
  }

  const now = new Date()
  const idleCutoff = new Date(now.getTime() - 10 * 60 * 1000)
  const futureWindow = new Date(now.getTime() + 15 * 60 * 1000)
  const channelIdleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const runningCandidates = await prisma.containerState.findMany({
    where: {
      containerPhase: "RUNNING",
      hasActiveChannels: false,
      lastActiveAt: { lt: idleCutoff },
      OR: [
        { nextHeartbeatAt: null },
        { nextHeartbeatAt: { gt: futureWindow } },
      ],
    },
    include: { workspace: { select: { id: true, containerId: true, status: true } } },
  })

  const warmCandidates = await prisma.containerState.findMany({
    where: {
      containerPhase: "WARM",
      OR: [
        { lastChannelMessageAt: { lt: channelIdleCutoff } },
        { lastChannelMessageAt: null },
      ],
    },
    include: { workspace: { select: { id: true, containerId: true, status: true } } },
  })

  const toHibernate = [...runningCandidates, ...warmCandidates]
    .filter((s) => s.workspace.containerId)
    .map((s) => ({
      workspaceId: s.workspaceId,
      containerId: s.workspace.containerId!,
    }))

  const wakeCandidates = await prisma.containerState.findMany({
    where: {
      containerPhase: "HIBERNATED",
      nextHeartbeatAt: { lte: new Date(now.getTime() + 10 * 60 * 1000), gt: now },
    },
    include: { workspace: { select: { id: true } } },
  })

  const toWake = wakeCandidates
    .filter((s) => {
      const leadTime = s.avgWakeDurationMs
        ? Math.min(600_000, Math.max(120_000, s.avgWakeDurationMs * 2))
        : 5 * 60 * 1000
      const wakeDeadline = new Date(s.nextHeartbeatAt!.getTime() - leadTime)
      return now >= wakeDeadline
    })
    .map((s) => ({
      workspaceId: s.workspaceId,
      savedContainerConfig: s.savedContainerConfig,
    }))

  return apiSuccess({ toHibernate, toWake })
}
