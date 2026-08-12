import { NextRequest } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import {
  releaseEligiblePayouts,
  getReleasablePayoutBatches,
  getProcessingPayoutBatches,
} from "@/lib/marketplace/payouts"
import { logAdminAction } from "@/lib/security/audit-log"

export const maxDuration = 30

/**
 * Cron (GET + Bearer CRON_SECRET): PENDING→RELEASABLE then list batches.
 * Admin GET: same release sweep + list (idempotent for already-RELEASABLE).
 */
export async function GET(request: NextRequest) {
  const cronAuth = request.headers.get("authorization")
  const isCron = cronAuth === `Bearer ${process.env.CRON_SECRET}` && !!process.env.CRON_SECRET

  if (!isCron) {
    try {
      await requireAdmin()
    } catch {
      return apiError("FORBIDDEN", "Admin access required", 403)
    }
  }

  // PR-10: daily cron was GET-only and never released — sweep first.
  const released = await releaseEligiblePayouts()
  const batches = await getReleasablePayoutBatches()
  const processing = await getProcessingPayoutBatches()

  return apiSuccess({
    released: released.released,
    releasedAmount: released.totalAmount,
    batches,
    processing,
  })
}

export async function POST(request: NextRequest) {
  const cronAuth = request.headers.get("authorization")
  const isCron = cronAuth === `Bearer ${process.env.CRON_SECRET}` && !!process.env.CRON_SECRET

  if (!isCron) {
    let admin
    try {
      admin = await requireAdmin()
    } catch {
      return apiError("FORBIDDEN", "Admin access required", 403)
    }

    logAdminAction({
      action: "payout.release",
      adminId: admin.id,
      adminEmail: admin.email || "unknown",
      targetId: "eligible",
      targetType: "payout",
      details: { trigger: "manual" },
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    })
  }

  const result = await releaseEligiblePayouts()

  return apiSuccess({
    released: result.released,
    totalAmount: result.totalAmount,
  })
}
