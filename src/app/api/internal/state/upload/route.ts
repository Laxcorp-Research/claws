import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const secret = req.headers.get("X-Metering-Secret")
  if (secret !== process.env.METERING_MASTER_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const body = await req.json()
  const { workspaceId, compressedState, uncompressedSize } = body

  if (!workspaceId || !compressedState) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 })
  }

  const stateBuffer = Buffer.from(compressedState, "base64")

  if (stateBuffer.length > 50 * 1024 * 1024) {
    log.warn("State snapshot too large, rejected", {
      workspaceId,
      compressedSize: stateBuffer.length,
    })
    return Response.json({ success: false, error: "State too large" }, { status: 413 })
  }

  const { count } = await prisma.containerState.updateMany({
    where: { workspaceId },
    data: {
      runtimeStateSnapshot: stateBuffer,
      runtimeStateUpdatedAt: new Date(),
      runtimeStateSizeBytes: uncompressedSize || 0,
    },
  })

  if (count === 0) {
    // Tripwire for the race PR2.5 closed at the deployer level: if this
    // ever fires again it means a container booted and sync'd before its
    // ContainerState row was created. State is silently discarded at the
    // DB layer; surface it loudly so the next bug can't hide.
    log.warn("State sync received but no ContainerState row — state discarded", {
      workspaceId,
      compressedBytes: stateBuffer.length,
      uncompressedBytes: uncompressedSize,
    })
  } else {
    log.info("Runtime state snapshot stored", {
      workspaceId,
      compressedBytes: stateBuffer.length,
      uncompressedBytes: uncompressedSize,
    })
  }

  return Response.json({ success: true, count })
}
