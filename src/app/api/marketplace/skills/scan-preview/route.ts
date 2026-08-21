import { NextRequest } from "next/server"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { scanSkillContent } from "@/lib/marketplace/skill-scan"
import { extractSkillRequirements, mergeSkillRequirements } from "@/lib/marketplace/skill-extract"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"

export const maxDuration = 30

/**
 * PR-3: skill publish wizard preview - regex scan + bins/env extraction.
 */
export async function POST(request: NextRequest) {
  if (!isMarketplacePublishEnabled()) {
    return apiError("COMING_SOON", "Skill publishing is coming soon", 403)
  }

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await request.json()
  const { skillMd, requiredBins, requiredEnvVars } = body as {
    skillMd?: string
    requiredBins?: string[]
    requiredEnvVars?: string[]
  }

  if (!skillMd || skillMd.trim().length < 20) {
    return ERRORS.VALIDATION("SKILL.md content is required (minimum 20 characters)")
  }

  const extracted = extractSkillRequirements(skillMd)
  const merged = mergeSkillRequirements(requiredBins, requiredEnvVars, extracted)
  const scanResult = scanSkillContent(skillMd)

  return apiSuccess({
    scanPassed: scanResult.passed,
    hasCritical: scanResult.hasCritical,
    hasWarnings: scanResult.hasWarnings,
    findings: scanResult.findings,
    extraction: extracted,
    merged: {
      requiredBins: merged.requiredBins,
      requiredEnvVars: merged.requiredEnvVars,
    },
    mismatchNote: merged.mismatchNote,
  })
}
