import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import type { ActivityType } from "@/generated/prisma/client"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId, id: agentId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { action } = body as { action?: string }

  if (!action || !["pause", "resume", "restart"].includes(action)) {
    return ERRORS.VALIDATION("Required: action (pause|resume|restart)")
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, workspaceId },
  })
  if (!agent) return ERRORS.NOT_FOUND("agent")

  if ((agent.role === "ORCHESTRATOR" || agent.role === "CRITIC") && action === "pause") {
    return apiError(
      "ROLE_NOT_PAUSABLE",
      "Orchestrator and Critic agents cannot be paused individually",
      400
    )
  }

  const actionTypeMap: Record<string, ActivityType> = {
    pause: "SYSTEM",
    resume: "SYSTEM",
    restart: "SYSTEM",
  }

  const actionLabelMap: Record<string, string> = {
    pause: "paused",
    resume: "resumed",
    restart: "restarted",
  }

  await prisma.activityLog.create({
    data: {
      workspaceId,
      agentName: agent.name,
      agentSlug: agent.agentSlug,
      action: `${agent.name} ${actionLabelMap[action]} by user`,
      actionType: actionTypeMap[action],
      metadata: JSON.stringify({
        controlAction: action,
        triggeredBy: user.email,
        triggeredAt: new Date().toISOString(),
      }),
    },
  })

  // TODO: Forward control command to OpenClaw container via deployer API

  const statusMap: Record<string, string> = {
    pause: "paused",
    resume: "running",
    restart: "restarting",
  }

  return apiSuccess({ status: statusMap[action] })
}
