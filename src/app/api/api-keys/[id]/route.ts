import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const key = await prisma.userApiKey.findFirst({ where: { id, userId: user.id } })
  if (!key) return ERRORS.NOT_FOUND("API key")

  await prisma.userApiKey.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
