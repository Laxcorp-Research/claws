import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"
import { log } from "@/lib/logger"

// before: 30 — after: 300 (belt with staging cron scheduler routes)
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const accounts = await prisma.creditAccount.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true, balanceCents: true },
  })

  let drifts = 0
  let reconciled = 0

  for (const account of accounts) {
    try {
      const redisBalance = await redis.get(`credit:balance:${account.userId}`)

      if (redisBalance === null) {
        await redis.set(`credit:balance:${account.userId}`, account.balanceCents.toString())
        reconciled++
        continue
      }

      const redisCents = parseInt(redisBalance as string)
      if (redisCents !== account.balanceCents) {
        drifts++
        log.warn("Credit balance drift detected", {
          userId: account.userId,
          redis: redisCents,
          db: account.balanceCents,
          drift: Math.abs(redisCents - account.balanceCents),
        })

        await redis.set(`credit:balance:${account.userId}`, account.balanceCents.toString())
        await redis.del(`credit:reservations:${account.userId}`)
        reconciled++
      }
    } catch (err) {
      log.error("Reconciliation failed for user", {
        userId: account.userId,
        error: String(err),
      })
    }
  }

  log.info("Credit balance reconciliation complete", {
    checked: accounts.length,
    drifts,
    reconciled,
  })

  return Response.json({ success: true, data: { checked: accounts.length, drifts, reconciled } })
}
