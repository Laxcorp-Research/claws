import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { isRailwayConfigured, getServiceStatus } from "@/lib/openclaw/railway-client"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      status: true,
      healthStatus: true,
      lastHealthCheck: true,
      containerId: true,
      containerName: true,
      containerHost: true,
      hostPort: true,
    },
  })

  if (!isRailwayConfigured() || !workspace?.containerId) {
    return apiSuccess({
      status: workspace?.status ?? "UNKNOWN",
      healthStatus: workspace?.healthStatus ?? "UNKNOWN",
      lastHealthCheck: workspace?.lastHealthCheck,
      containerId: workspace?.containerId,
      containerName: workspace?.containerName,
      containerHost: workspace?.containerHost,
      mode: "simulation",
    })
  }

  try {
    const railwayStatus = await getServiceStatus(workspace.containerId)
    return apiSuccess({
      status: workspace.status,
      healthStatus: workspace.healthStatus,
      lastHealthCheck: workspace.lastHealthCheck,
      containerId: workspace.containerId,
      containerName: workspace.containerName,
      containerHost: workspace.containerHost,
      container: {
        running: railwayStatus.healthy,
        containerStatus: railwayStatus.status,
        deploymentId: railwayStatus.deploymentId,
        createdAt: railwayStatus.createdAt,
      },
    })
  } catch {
    return apiSuccess({
      status: workspace.status,
      healthStatus: workspace.healthStatus,
      lastHealthCheck: workspace.lastHealthCheck,
      containerId: workspace.containerId,
      containerName: workspace.containerName,
      containerHost: workspace.containerHost,
      container: {
        running: false,
        containerStatus: "unreachable",
      },
    })
  }
}
