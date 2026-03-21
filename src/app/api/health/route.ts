import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    database: "error",
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = "ok"
  } catch {
    checks.database = "error"
  }

  const allOk = Object.values(checks).every((v) => v === "ok")

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      checks,
      version: process.env.npm_package_version || "1.0.0",
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  )
}
