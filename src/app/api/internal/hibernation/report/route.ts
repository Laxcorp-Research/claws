import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("Authorization")
  if (auth !== `Bearer ${process.env.CONTAINER_AGENT_SECRET}`) {
    return apiError("UNAUTHORIZED", "Invalid agent secret", 401)
  }

  const body = await req.json()
  const { workspaceId, action } = body

  if (action === "HIBERNATED") {
    await prisma.$transaction([
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          containerPhase: "HIBERNATED",
          hibernatedAt: new Date(),
          savedContainerConfig: body.savedConfig ? JSON.stringify(body.savedConfig) : undefined,
          savedVolumeId: body.volumeName,
        },
      }),
      prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "HIBERNATED",
          containerId: null,
          containerPort: null,
          hostPort: null,
        },
      }),
    ])
    log.info("Container hibernated", { workspaceId })
  }

  if (action === "WOKE") {
    const wakeDuration = body.wakeDurationMs as number
    const existing = await prisma.containerState.findUnique({ where: { workspaceId } })

    await prisma.$transaction([
      prisma.containerState.update({
        where: { workspaceId },
        data: {
          containerPhase: existing?.hasActiveChannels ? "WARM" : "RUNNING",
          lastActiveAt: new Date(),
          hibernatedAt: null,
          wakeRequestedAt: null,
          lastWakeDurationMs: wakeDuration,
          avgWakeDurationMs: existing?.avgWakeDurationMs
            ? Math.round(existing.avgWakeDurationMs * 0.7 + wakeDuration * 0.3)
            : wakeDuration,
        },
      }),
      prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "RUNNING",
          containerId: body.containerId,
          containerPort: 18789,
          hostPort: body.hostPort,
        },
      }),
    ])
    log.info("Container woke", { workspaceId, wakeDurationMs: wakeDuration })
  }

  return apiSuccess({ ok: true })
}
