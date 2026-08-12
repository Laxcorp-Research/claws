import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { markPayoutProcessing } from "@/lib/marketplace/payouts"
import { logAdminAction } from "@/lib/security/audit-log"

export async function POST(request: NextRequest) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  const body = (await request.json()) as { saleIds?: string[]; creatorId?: string }
  let saleIds = body.saleIds
  if ((!saleIds || saleIds.length === 0) && body.creatorId) {
    const sales = await prisma.marketplaceSale.findMany({
      where: {
        creatorId: body.creatorId,
        payoutStatus: "RELEASABLE",
        adjustmentOfSaleId: null,
      },
      select: { id: true },
    })
    saleIds = sales.map((s) => s.id)
  }
  if (!saleIds || saleIds.length === 0) {
    return ERRORS.VALIDATION("saleIds or creatorId with RELEASABLE sales required")
  }

  try {
    const batchId = await markPayoutProcessing(saleIds)
    logAdminAction({
      action: "payout.process",
      adminId: admin.id,
      adminEmail: admin.email || "",
      targetId: batchId,
      targetType: "payout",
      details: { saleIds, batchId },
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    })
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "PAYOUT_MARKED_PROCESSING",
        resource: "payout_batch",
        resourceId: batchId,
        after: JSON.stringify({ saleIds, batchId }),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      },
    })
    return apiSuccess({ batchId, saleCount: saleIds.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed"
    if (msg.includes("ILLEGAL_TRANSITION")) {
      return apiError("ILLEGAL_TRANSITION", msg, 400)
    }
    return apiError("INTERNAL_ERROR", msg, 500)
  }
}
