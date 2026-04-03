import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { scanTemplate } from "@/lib/marketplace/template-scan"

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return apiError("UNAUTHORIZED", "Sign in required", 401)

    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId || typeof workspaceId !== "string") {
      return apiError("VALIDATION", "workspaceId is required", 400)
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        agents: true,
      },
    })

    if (!workspace || workspace.userId !== user.id) {
      return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
    }

    if (workspace.agents.length === 0) {
      return apiError("VALIDATION", "Workspace has no agents", 400)
    }

    const scanResult = scanTemplate(
      workspace.agents.map((a) => ({
        name: a.name,
        soulMd: a.soulMd,
        agentsMd: a.agentsMd,
        heartbeatMd: a.heartbeatMd || undefined,
      }))
    )

    return apiSuccess({ scanResult })
  } catch (error) {
    console.error("Scan preview error:", error)
    return apiError("SCAN_ERROR", "Failed to run security scan", 500)
  }
}
