import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const secret = req.headers.get("X-Metering-Secret")
  if (secret !== process.env.METERING_MASTER_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) {
    return Response.json({ success: false, error: "Missing workspaceId" }, { status: 400 })
  }

  const state = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: { runtimeStateSnapshot: true, runtimeStateUpdatedAt: true },
  })

  if (!state?.runtimeStateSnapshot) {
    return Response.json({ success: true, data: { hasState: false } })
  }

  const base64State = Buffer.from(state.runtimeStateSnapshot).toString("base64")

  return Response.json({
    success: true,
    data: {
      hasState: true,
      compressedState: base64State,
      updatedAt: state.runtimeStateUpdatedAt?.toISOString(),
    },
  })
}
