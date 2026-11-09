import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { hashOwnerPassword } from "@/lib/auth/owner-password"
import { isSelfHost } from "@/lib/profile"

export const maxDuration = 30

/**
 * First-run owner. Creates a password account only when the database has
 * zero users and CLAWS_PROFILE=self-host. A second call does not create
 * another owner.
 */
export async function POST(req: NextRequest) {
  if (!isSelfHost()) return ERRORS.NOT_FOUND("Route")

  let body: { email?: unknown; password?: unknown; name?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return ERRORS.VALIDATION("Request body must be JSON")
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!email.includes("@") || email.length > 200) {
    return ERRORS.VALIDATION("A valid email is required")
  }
  if (password.length < 12 || password.length > 200) {
    return ERRORS.VALIDATION("Password must be 12–200 characters")
  }

  const created = await prisma.$transaction(async (tx) => {
    const count = await tx.user.count()
    if (count > 0) return null
    return tx.user.create({
      data: {
        email,
        name: name || email,
        hashedPassword: await hashOwnerPassword(password),
        emailVerified: new Date(),
      },
      select: { id: true, email: true },
    })
  })

  if (!created) {
    return apiError("OWNER_EXISTS", "An owner account already exists.", 409)
  }
  return apiSuccess(created, 201)
}
