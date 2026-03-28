import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import type { ReportReason } from "@/generated/prisma/client"

const VALID_REASONS: ReportReason[] = [
  "MALICIOUS", "MISLEADING", "COPYRIGHT", "SPAM",
  "INAPPROPRIATE", "BROKEN", "NAME_CONFLICT",
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!template) return ERRORS.NOT_FOUND("template")

  const body = await request.json()
  const { reason, details } = body as { reason?: string; details?: string }

  if (!reason || !VALID_REASONS.includes(reason as ReportReason)) {
    return ERRORS.VALIDATION(`Reason must be one of: ${VALID_REASONS.join(", ")}`)
  }
  if (details && details.length > 2000) {
    return ERRORS.VALIDATION("Details must be 2000 characters or less")
  }

  const report = await prisma.report.create({
    data: {
      templateId: template.id,
      reporterId: user.id,
      reason: reason as ReportReason,
      details: details?.trim() || null,
    },
  })

  return apiSuccess({ reportId: report.id }, 201)
}
