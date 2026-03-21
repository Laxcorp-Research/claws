import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const skill = await prisma.skill.findUnique({ where: { slug } })
  if (!skill) return ERRORS.NOT_FOUND("skill")

  return apiSuccess(skill)
}
