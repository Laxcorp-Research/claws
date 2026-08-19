import { NextRequest, after } from "next/server"
import { drainProvisioningQueueHead } from "@/lib/railway/governor"
import { log } from "@/lib/logger"

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const result = await drainProvisioningQueueHead((fn) => {
    after(fn)
  })

  log.info("provisioning-queue drain", result)
  return Response.json({ success: true, data: result })
}
