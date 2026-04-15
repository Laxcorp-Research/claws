import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { redis } from "@/lib/redis"

export async function POST(req: NextRequest) {
  const secret = req.headers.get("X-Metering-Secret")
  if (secret !== process.env.METERING_MASTER_SECRET) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  const { userId, releaseCents } = await req.json()

  if (!userId || !releaseCents || releaseCents < 0) {
    return apiError("VALIDATION_ERROR", "userId and positive releaseCents required", 400)
  }

  await redis.decrby(`credit:reservations:${userId}`, releaseCents)

  return apiSuccess({ released: true })
}
