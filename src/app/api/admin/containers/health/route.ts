import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { getAdminUser } from "@/lib/api/admin"
import { isRailwayConfigured, listProjectServices } from "@/lib/openclaw/railway-client"

export async function GET(_req: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return apiError("ADMIN_REQUIRED", "Admin access required", 403)

  if (!isRailwayConfigured()) {
    return apiSuccess({
      configured: false,
      provider: "railway",
      services: [],
    })
  }

  try {
    const services = await listProjectServices()
    return apiSuccess({
      configured: true,
      provider: "railway",
      services,
    })
  } catch {
    return apiSuccess({
      configured: true,
      provider: "railway",
      services: [],
      error: "Failed to query Railway API",
    })
  }
}
