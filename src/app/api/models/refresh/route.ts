import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { refreshAllModelCatalogs } from "@/lib/models/catalog"

/** On-demand catalog refresh (admin) — same job as daily cron. */
export async function POST(_req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  try {
    const result = await refreshAllModelCatalogs()
    return apiSuccess(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return apiError("INTERNAL_ERROR", msg, 500)
  }
}
