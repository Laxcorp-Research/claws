import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { name, email } = body as { name?: string; email?: string }

  const updateData: Record<string, string> = {}
  if (name !== undefined) updateData.name = name
  if (email !== undefined) {
    if (!email || !email.includes("@")) return ERRORS.VALIDATION("Invalid email address")
    const existing = await prisma.user.findFirst({ where: { email, id: { not: user.id } } })
    if (existing) return ERRORS.VALIDATION("Email already in use")
    updateData.email = email
  }

  if (Object.keys(updateData).length === 0) return ERRORS.VALIDATION("No fields to update")

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
    select: { id: true, name: true, email: true, avatarUrl: true },
  })

  return apiSuccess({ user: { id: updated.id, name: updated.name, email: updated.email, image: updated.avatarUrl } })
}

export async function DELETE() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  await prisma.user.delete({ where: { id: user.id } })
  return apiSuccess({ deleted: true })
}
