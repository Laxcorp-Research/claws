import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const account = await prisma.creditAccount.findUnique({
    where: { userId: user.id },
  })

  if (!account) {
    return apiSuccess({
      hasCredits: false,
      balanceCents: 0,
      status: null,
    })
  }

  return apiSuccess({
    hasCredits: true,
    balanceCents: account.balanceCents,
    totalConsumedCents: account.totalConsumedCents,
    initialGrantCents: account.initialGrantCents,
    status: account.status,
    grantedAt: account.grantedAt.toISOString(),
    exhaustedAt: account.exhaustedAt?.toISOString() || null,
  })
}
