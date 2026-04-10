import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { isRailwayConfigured, getServiceLogs } from "@/lib/openclaw/railway-client"

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { containerId: true },
  })

  if (!isRailwayConfigured() || !workspace?.containerId) {
    return apiSuccess({ logs: "[No container running — deploy first]" })
  }

  const url = new URL(req.url)
  const tail = parseInt(url.searchParams.get("tail") || "100", 10)

  try {
    const logs = await getServiceLogs(workspace.containerId, tail)
    return apiSuccess({ logs })
  } catch {
    return apiSuccess({ logs: "[Failed to fetch logs]" })
  }
}
