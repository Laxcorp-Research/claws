import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess } from "@/lib/api/response"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type")
  const category = searchParams.get("category")

  const where: Record<string, unknown> = {}
  if (type) where.type = type
  if (category) where.category = category

  const skills = await prisma.skill.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      type: true,
      category: true,
      icon: true,
      compatibleTools: true,
      requiresToolConnection: true,
      isBuiltIn: true,
      isVerified: true,
    },
    orderBy: [{ type: "asc" }, { category: "asc" }, { name: "asc" }],
  })

  return apiSuccess({ skills })
}
