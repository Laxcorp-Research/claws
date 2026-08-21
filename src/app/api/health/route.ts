import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { runDecryptCanary } from "@/lib/encryption-health"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    database: "error",
    encryption: "ok",
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = "ok"
  } catch {
    checks.database = "error"
  }

  // Decrypt canary: if existing secrets can't be decrypted under the current
  // ENCRYPTION_MASTER_KEY (key mismatch), this flips health to degraded AND logs
  // loudly - so a bad/rotated key is obvious at deploy time instead of silently
  // 500ing every secret operation. runDecryptCanary never throws / never false-
  // alarms on a DB issue (the database check above owns that).
  const enc = await runDecryptCanary()
  checks.encryption = enc.ok ? "ok" : "error"

  const allOk = Object.values(checks).every((v) => v === "ok")

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      checks,
      version: process.env.npm_package_version || "1.0.0",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7),
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  )
}
