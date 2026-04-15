import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { containerState: true },
  })

  if (!workspace) return ERRORS.NOT_FOUND("Workspace")
  if (workspace.userId !== user.id) return ERRORS.FORBIDDEN()

  if (workspace.status !== "HIBERNATED") {
    return apiError("INVALID_STATE", `Cannot wake workspace in ${workspace.status} state`, 400)
  }

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "WAKING" },
    }),
    prisma.containerState.update({
      where: { workspaceId },
      data: { containerPhase: "WAKING", wakeRequestedAt: new Date() },
    }),
  ])

  if (process.env.CONTAINER_AGENT_URL) {
    fetch(`${process.env.CONTAINER_AGENT_URL}/wake`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CONTAINER_AGENT_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceId }),
    }).catch((err) => {
      log.error("Wake webhook failed, will rely on polling", { workspaceId, error: String(err) })
    })
  }

  return apiSuccess({ status: "WAKING" })
}
