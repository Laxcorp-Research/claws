// KEEP: operations dependency probe; also intended for direct human inspection.
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { redis } from "@/lib/redis"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Deep health for uptime monitors that need dependency liveness beyond
 * process+DB. Response never includes secrets or connection strings.
 */
export async function GET() {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    database: "error",
    redis: "error",
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = "ok"
  } catch {
    checks.database = "error"
  }

  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      checks.redis = "error"
    } else {
      const pong = await redis.ping()
      checks.redis = pong === "PONG" || pong === "pong" ? "ok" : "error"
    }
  } catch {
    checks.redis = "error"
  }

  const allOk = Object.values(checks).every((v) => v === "ok")

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      checks,
      version: process.env.npm_package_version || "1.0.0",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7),
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  )
}
