import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getPortalUrl } from "@/lib/dodo-payments"

export async function POST() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return ERRORS.UNAUTHORIZED()

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } })
  if (!user) return ERRORS.NOT_FOUND("User")

  if (!user.dodoCustomerId) {
    return apiSuccess({ portalUrl: null, message: "No billing history yet" })
  }

  try {
    const portalUrl = await getPortalUrl(user.dodoCustomerId)
    if (!portalUrl) return apiSuccess({ portalUrl: null, message: "Billing portal not available in development mode" })
    return apiSuccess({ portalUrl })
  } catch (error) {
    console.error("[Portal Error]", error)
    return apiSuccess({ portalUrl: null, message: "Failed to open billing portal" })
  }
}
