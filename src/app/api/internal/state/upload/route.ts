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

  await prisma.containerState.updateMany({
    where: { workspaceId },
    data: {
      runtimeStateSnapshot: stateBuffer,
      runtimeStateUpdatedAt: new Date(),
      runtimeStateSizeBytes: uncompressedSize || 0,
    },
  })

  log.info("Runtime state snapshot stored", {
    workspaceId,
    compressedBytes: stateBuffer.length,
    uncompressedBytes: uncompressedSize,
  })

  return Response.json({ success: true })
}
