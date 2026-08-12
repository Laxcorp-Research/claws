import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError } from "@/lib/api/response"
import { computeSkillContentDigest } from "@/lib/marketplace/sandbox-digest"
import { reportMatchesDigest } from "@/lib/marketplace/sandbox-grade"
import type { SandboxReportV1 } from "@/lib/marketplace/sandbox-types"
import { SANDBOX_REPORT_VERSION } from "@/lib/marketplace/sandbox-types"
import { log } from "@/lib/logger"

/**
 * Staging intake for sandbox worker reports.
 * Auth: X-Sandbox-Report-Token === SANDBOX_REPORT_TOKEN
 * Idempotent: same (skillId, contentDigest) overwrites with same digest only.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SANDBOX_REPORT_TOKEN
  if (!expected) {
    log.error("SANDBOX_REPORT_TOKEN not configured; rejecting sandbox-report")
    return apiError("SANDBOX_TOKEN_UNCONFIGURED", "Sandbox token not configured", 401)
  }
  if (req.headers.get("X-Sandbox-Report-Token") !== expected) {
    return apiError("UNAUTHORIZED", "Invalid sandbox token", 401)
  }

  let body: SandboxReportV1
  try {
    body = (await req.json()) as SandboxReportV1
  } catch {
    return apiError("VALIDATION_ERROR", "Request body must be JSON", 400)
  }

  if (body?.version !== SANDBOX_REPORT_VERSION) {
    return apiError("VALIDATION_ERROR", "Unsupported sandbox report version", 400)
  }
  if (typeof body.skillId !== "string" || !body.skillId) {
    return apiError("VALIDATION_ERROR", "skillId required", 400)
  }
  if (typeof body.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.contentDigest)) {
    return apiError("VALIDATION_ERROR", "contentDigest must be sha256 hex", 400)
  }
  if (typeof body.passed !== "boolean" || !Array.isArray(body.violations)) {
    return apiError("VALIDATION_ERROR", "passed + violations required", 400)
  }

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { id: body.skillId },
    select: {
      id: true,
      skillMd: true,
      requiredBins: true,
      requiredEnvVars: true,
      sandboxReport: true,
    },
  })
  if (!skill) return apiError("NOT_FOUND", "Skill not found", 404)

  const liveDigest = computeSkillContentDigest({
    skillMd: skill.skillMd,
    requiredBins: skill.requiredBins,
    requiredEnvVars: skill.requiredEnvVars,
  })
  if (liveDigest !== body.contentDigest) {
    return apiError("DIGEST_MISMATCH", "Report digest does not match current skill content", 409)
  }

  // Idempotent reuse: if already stored for this digest, accept without churn.
  if (reportMatchesDigest(skill.sandboxReport, body.contentDigest)) {
    return apiSuccess({ skillId: skill.id, contentDigest: body.contentDigest, reused: true })
  }

  const reportJson = JSON.stringify(body)
  await prisma.marketplaceSkill.update({
    where: { id: skill.id },
    data: {
      sandboxPassed: body.passed,
      sandboxReport: reportJson,
    },
  })

  log.info("Sandbox report persisted", {
    category: "marketplace",
    skillId: skill.id,
    contentDigest: body.contentDigest,
    passed: body.passed,
    violationCount: body.violations.length,
  })

  return apiSuccess({
    skillId: skill.id,
    contentDigest: body.contentDigest,
    sandboxPassed: body.passed,
    reused: false,
  })
}
