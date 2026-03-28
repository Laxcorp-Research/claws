import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess } from "@/lib/api/response"
import { generateSlug } from "@/lib/marketplace/slug-utils"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const name = searchParams.get("name")

  if (!name || name.trim().length < 3) {
    return apiSuccess({ available: false, reason: "Name must be at least 3 characters" })
  }

  const conflict = await prisma.clawTemplate.findFirst({
    where: {
      name: { equals: name.trim(), mode: "insensitive" },
      trustTier: "OFFICIAL",
    },
    select: { name: true },
  })

  if (conflict) {
    return apiSuccess({ available: false, reason: `Conflicts with official template "${conflict.name}"` })
  }

  const slugConflict = await prisma.clawTemplate.findFirst({
    where: { slug: generateSlug(name.trim()) },
    select: { name: true },
  })

  if (slugConflict) {
    return apiSuccess({ available: false, reason: "A template with a similar name already exists" })
  }

  return apiSuccess({ available: true })
}
