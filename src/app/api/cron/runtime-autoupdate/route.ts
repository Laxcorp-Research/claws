import { NextRequest } from "next/server"
import { apiError, apiSuccess } from "@/lib/api/response"
import { pingStaleCandidates } from "@/lib/openclaw/runtime-autoupdate"
import { log } from "@/lib/logger"

export const maxDuration = 30

/**
 * Daily autoupdate lane tick: stale (>14d unsoaked) candidate owner ping.
 * Never silence; cooldown is 24h so the founder is not spammed per minute.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return apiError("UNAUTHORIZED", "Unauthorized", 401)
  }

  const result = await pingStaleCandidates()
  log.info("runtime-autoupdate: stale ping tick", result)
  return apiSuccess(result)
}
