import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { refreshAllModelCatalogs } from "@/lib/models/catalog"
import { log } from "@/lib/logger"

export const maxDuration = 60

/** Daily cron: seed natives + refresh OpenRouter /models into ModelCatalogEntry. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return apiError("UNAUTHORIZED", "Unauthorized", 401)
  }

  try {
    const result = await refreshAllModelCatalogs()
    log.info("Model catalog cron complete", { category: "models", ...result })
    return apiSuccess(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("Model catalog cron failed", { category: "models", error: msg })
    return apiError("INTERNAL_ERROR", msg, 500)
  }
}
