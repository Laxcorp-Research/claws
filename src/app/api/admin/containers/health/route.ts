import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { getAdminUser } from "@/lib/api/admin"
import {
  checkAgentHealth,
  listContainers,
  isContainerHostConfigured,
} from "@/lib/container-client"

export async function GET(_req: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return apiError("ADMIN_REQUIRED", "Admin access required", 403)

  if (!isContainerHostConfigured()) {
    return apiSuccess({
      configured: false,
      agentHealthy: false,
      containers: [],
    })
  }

  const agentHealthy = await checkAgentHealth()
  let containers: unknown[] = []

  if (agentHealthy) {
    try {
      containers = await listContainers()
    } catch {
      containers = []
    }
  }

  return apiSuccess({
    configured: true,
    agentHealthy,
    containers,
  })
}
