import { NextRequest } from "next/server"
import { apiError, apiSuccess } from "@/lib/api/response"
import { markSoakGreen } from "@/lib/openclaw/runtime-autoupdate"
import { log } from "@/lib/logger"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function authorized(req: NextRequest): boolean {
  const pipeline = process.env.VERSION_PIPELINE_SECRET
  if (pipeline && req.headers.get("X-Pipeline-Secret") === pipeline) return true
  const cron = process.env.CRON_SECRET
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true
  return false
}

/**
 * 24h soak green signal. Overlay -N auto-promotes isStable.
 * Date-tuple / upstream-revision: founder ACK only (no pin).
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return apiError("UNAUTHORIZED", "Invalid pipeline or cron secret", 401)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError("VALIDATION_ERROR", "JSON body required", 400)
  }
  if (!isRecord(body) || typeof body.version !== "string" || body.green !== true) {
    return apiError("VALIDATION_ERROR", "version string and green:true required", 400)
  }

  try {
    const result = await markSoakGreen(body.version.trim())
    log.info("runtime-autoupdate: soak signal", { version: body.version, ...result })
    return apiSuccess(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes("not found")) {
      return apiError("NOT_FOUND", message, 404)
    }
    log.error("runtime-autoupdate: soak signal failed", { error: message })
    return apiError("INTERNAL_ERROR", "Failed to record soak signal", 500)
  }
}
