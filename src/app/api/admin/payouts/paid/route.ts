import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { markPayoutPaid } from "@/lib/marketplace/payouts"
import { logAdminAction } from "@/lib/security/audit-log"

export async function POST(request: NextRequest) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  const body = (await request.json()) as { batchId?: string; transferRef?: string }
  if (!body.batchId || !body.transferRef?.trim()) {
    return ERRORS.VALIDATION("batchId and transferRef required")
  }

  try {
    const result = await markPayoutPaid({
      batchId: body.batchId,
      transferRef: body.transferRef,
    })
    logAdminAction({
      action: "payout.process",
      adminId: admin.id,
      adminEmail: admin.email || "",
      targetId: body.batchId,
      targetType: "payout",
      details: {
        phase: "paid",
        transferRef: body.transferRef.trim(),
        paidCount: result.paidCount,
        totalPayout: result.totalPayout,
      },
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    })
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "PAYOUT_MARKED_PAID",
        resource: "payout_batch",
        resourceId: body.batchId,
        after: JSON.stringify({
          transferRef: body.transferRef.trim(),
          paidCount: result.paidCount,
          totalPayout: result.totalPayout,
          // Durable record of the creator-notification outcome (payouts have
          // no workspace, so this AuditLog row is their email ledger).
          notifyEmail: result.notifyEmail,
        }),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      },
    })
    return apiSuccess(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed"
    if (msg.includes("ILLEGAL_TRANSITION")) {
      return apiError("ILLEGAL_TRANSITION", msg, 400)
    }
    if (msg.includes("TRANSFER_REF")) {
      return ERRORS.VALIDATION(msg)
    }
    return apiError("INTERNAL_ERROR", msg, 500)
  }
}
