import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { requireAdmin } from "@/lib/api/admin"
import { logAdminAction } from "@/lib/security/audit-log"
import { enqueueSkillSandbox } from "@/lib/marketplace/sandbox-enqueue"

/** Admin re-run: clears report for current digest force, then dispatches. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError("FORBIDDEN", "Admin access required", 403)
  }

  const { id } = await params
  const skill = await prisma.marketplaceSkill.findUnique({ where: { id } })
  if (!skill) return apiError("NOT_FOUND", "Skill not found", 404)

  const force =
    request.nextUrl.searchParams.get("force") === "1" ||
    (await request.json().catch(() => ({})) as { force?: boolean }).force === true

  if (force) {
    await prisma.marketplaceSkill.update({
      where: { id },
      data: { sandboxPassed: null, sandboxReport: null },
    })
  }

  const result = await enqueueSkillSandbox(id)

  logAdminAction({
    action: "skill.sandbox_rerun",
    adminId: admin.id,
    adminEmail: admin.email || "",
    targetId: id,
    targetType: "skill",
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    details: { result, force },
  })

  return apiSuccess(result)
}
