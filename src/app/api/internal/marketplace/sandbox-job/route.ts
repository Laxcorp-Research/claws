import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { computeSkillContentDigest } from "@/lib/marketplace/sandbox-digest"
import { log } from "@/lib/logger"

/**
 * GHA sandbox worker fetches skill payload (zero creds - content only).
 * Auth: X-Sandbox-Report-Token === SANDBOX_REPORT_TOKEN
 */
export async function GET(req: NextRequest) {
  const expected = process.env.SANDBOX_REPORT_TOKEN
  if (!expected) {
    log.error("SANDBOX_REPORT_TOKEN not configured; rejecting sandbox-job fetch")
    return apiError("SANDBOX_TOKEN_UNCONFIGURED", "Sandbox token not configured", 401)
  }
  if (req.headers.get("X-Sandbox-Report-Token") !== expected) {
    return apiError("UNAUTHORIZED", "Invalid sandbox token", 401)
  }

  const skillId = req.nextUrl.searchParams.get("skillId")?.trim() || ""
  const contentDigest = req.nextUrl.searchParams.get("contentDigest")?.trim() || ""
  if (!skillId || !contentDigest) {
    return apiError("VALIDATION_ERROR", "skillId and contentDigest are required", 400)
  }

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { id: skillId },
    select: {
      id: true,
      slug: true,
      skillMd: true,
      requiredBins: true,
      requiredEnvVars: true,
    },
  })
  if (!skill) return apiError("NOT_FOUND", "Skill not found", 404)

  const digest = computeSkillContentDigest({
    skillMd: skill.skillMd,
    requiredBins: skill.requiredBins,
    requiredEnvVars: skill.requiredEnvVars,
  })
  if (digest !== contentDigest) {
    return apiError("DIGEST_MISMATCH", "Skill content digest does not match", 409)
  }

  return apiSuccess({
    skillId: skill.id,
    slug: skill.slug,
    skillMd: skill.skillMd,
    requiredBins: skill.requiredBins,
    requiredEnvVars: skill.requiredEnvVars,
    contentDigest: digest,
  })
}
