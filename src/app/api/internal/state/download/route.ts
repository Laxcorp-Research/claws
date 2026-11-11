import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { assertSyncCredential } from "@/lib/openclaw/state-sync-auth"

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) {
    return Response.json({ success: false, error: "Missing workspaceId" }, { status: 400 })
  }
  if (!(await assertSyncCredential(req, workspaceId))) {
    return new Response("Unauthorized", { status: 401 })
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
