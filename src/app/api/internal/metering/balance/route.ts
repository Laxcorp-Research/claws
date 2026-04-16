import { NextRequest } from "next/server"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { redis } from "@/lib/redis"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  const secret = req.headers.get("X-Metering-Secret")
  if (secret !== process.env.METERING_MASTER_SECRET) {
    return apiError("UNAUTHORIZED", "Invalid metering secret", 401)
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) {
    return apiError("VALIDATION_ERROR", "workspaceId required", 400)
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true },
  })
  if (!workspace) {
    return ERRORS.NOT_FOUND("Workspace")
  }

  const cached = await redis.get(`credit:balance:${workspace.userId}`)
  if (cached !== null) {
    return apiSuccess({ balanceCents: parseInt(cached as string) })
  }

  const account = await prisma.creditAccount.findUnique({
    where: { userId: workspace.userId },
  })

  const balance = account?.balanceCents ?? 0

  if (account) {
    await redis.set(`credit:balance:${workspace.userId}`, balance.toString())
  }

  return apiSuccess({ balanceCents: balance })
}
