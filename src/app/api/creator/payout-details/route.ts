import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import {
  encryptPayoutDetails,
  maskPayoutDetails,
  payoutMethodLabel,
  validatePayoutDetails,
} from "@/lib/marketplace/payout-details"

/** Masked read only — never returns decrypted fields. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
    select: {
      payoutMethod: true,
      payoutDetailsHint: true,
      payoutDetailsUpdatedAt: true,
      payoutDetailsEncrypted: true,
    },
  })
  if (!profile) return apiError("NOT_ENROLLED", "Not enrolled as creator", 403)

  return apiSuccess({
    method: profile.payoutMethod,
    methodLabel: payoutMethodLabel(profile.payoutMethod),
    masked: profile.payoutDetailsHint,
    hasDetails: !!profile.payoutDetailsEncrypted,
    updatedAt: profile.payoutDetailsUpdatedAt?.toISOString() ?? null,
    // Explicit contract: no plaintext keys in this payload.
    plaintext: null,
  })
}

/** Full re-entry required on every save (edit does not patch secrets). */
export async function PUT(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!profile) return apiError("NOT_ENROLLED", "Not enrolled as creator", 403)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return ERRORS.VALIDATION("Invalid JSON")
  }

  try {
    const details = validatePayoutDetails(body)
    const encrypted = encryptPayoutDetails(details)
    // Mutation lock: refuse if caller somehow sent a field named plaintext storage.
    if (typeof (body as { payoutDetailsEncrypted?: unknown }).payoutDetailsEncrypted === "string") {
      return apiError("FORBIDDEN", "Cannot write encrypted blob directly", 400)
    }

    const hint = maskPayoutDetails(details)
    const updated = await prisma.creatorProfile.update({
      where: { id: profile.id },
      data: {
        payoutDetailsEncrypted: encrypted,
        payoutMethod: details.method,
        payoutDetailsHint: hint,
        payoutDetailsUpdatedAt: new Date(),
      },
      select: {
        payoutMethod: true,
        payoutDetailsHint: true,
        payoutDetailsUpdatedAt: true,
      },
    })

    return apiSuccess({
      method: updated.payoutMethod,
      methodLabel: payoutMethodLabel(updated.payoutMethod),
      masked: updated.payoutDetailsHint,
      hasDetails: true,
      updatedAt: updated.payoutDetailsUpdatedAt?.toISOString() ?? null,
      plaintext: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payout details"
    if (msg.startsWith("PAYOUT_")) {
      return apiError("VALIDATION_ERROR", msg, 400)
    }
    throw err
  }
}
