import { NextRequest } from "next/server"
import { refillServicePoolTick } from "@/lib/railway/service-pool"
import { log } from "@/lib/logger"

export const maxDuration = 300

/**
 * Service pool refill tick (every 5 minutes):
 *   1. retry RECYCLING rows (privacy wipe must fully receipt before READY)
 *   2. reclaim stranded ASSIGNED rows
 *   3. bank empty serviceCreates up to governor budget minus headroom
 *   4. low-watermark owner alert (< SERVICE_POOL_LOW_WATERMARK, default 20)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Phase 0: warm-pool refill is retired. Opt in only with SERVICE_POOL_REFILL=true.
  if (process.env.SERVICE_POOL_REFILL !== "true") {
    return Response.json({ success: true, data: { enabled: false, retired: true, created: 0 } })
  }

  const result = await refillServicePoolTick()

  log.info("service-pool cron tick", { ...result })
  return Response.json({ success: true, data: result })
}
