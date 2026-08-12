import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { decryptPayoutDetails, payoutMethodLabel } from "@/lib/marketplace/payout-details"
import { logAdminAction } from "@/lib/security/audit-log"

/** Decrypt-on-demand for admin payout ritual. Always audit-ledgered. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> },
) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  const { creatorId } = await params
  const profile = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      displayName: true,
      payoutMethod: true,
      payoutDetailsEncrypted: true,
      user: { select: { email: true } },
    },
  })
  if (!profile) return apiError("NOT_FOUND", "Creator not found", 404)
  if (!profile.payoutDetailsEncrypted) {
    return apiError("NOT_FOUND", "Creator has not saved payout details", 404)
  }

  const details = decryptPayoutDetails(profile.payoutDetailsEncrypted)

  logAdminAction({
    action: "payout.process",
    adminId: admin.id,
    adminEmail: admin.email || "",
    targetId: creatorId,
    targetType: "payout",
    details: { event: "PAYOUT_DETAILS_VIEWED", creatorId },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  })

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "PAYOUT_DETAILS_VIEWED",
      resource: "creator_payout_details",
      resourceId: creatorId,
      after: JSON.stringify({
        creatorId,
        method: profile.payoutMethod,
        viewedAt: new Date().toISOString(),
      }),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    },
  })

  return apiSuccess({
    creatorId,
    displayName: profile.displayName,
    creatorEmail: profile.user.email,
    method: profile.payoutMethod,
    methodLabel: payoutMethodLabel(profile.payoutMethod),
    details,
  })
}
