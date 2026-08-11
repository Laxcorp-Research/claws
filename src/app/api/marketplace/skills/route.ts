import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { Prisma, TrustTier } from "@/generated/prisma/client"
import { scanSkillContent } from "@/lib/marketplace/skill-scan"
import { runLLMSecurityReview } from "@/lib/marketplace/llm-security-review"
import { generateUniqueSlug } from "@/lib/marketplace/slug-utils"
import { sanitizeText, sanitizeMarkdown } from "@/lib/security/sanitize"
import { log } from "@/lib/logger"
import { searchSkills } from "@/lib/marketplace/search"
import { publicListingWhere } from "@/lib/marketplace/public-visibility"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"

export const maxDuration = 30

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const category = searchParams.get("category") || undefined
    const trustTier = searchParams.get("trustTier") || undefined
    const isFreeParam = searchParams.get("isFree")
    const isFree =
      isFreeParam === "true" ? true : isFreeParam === "false" ? false : undefined
    const search = searchParams.get("search") || undefined
    const sort = searchParams.get("sort") || "popular"
    const cursor = searchParams.get("cursor") || undefined
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50)
    const section = searchParams.get("section") || undefined

    const where: Prisma.MarketplaceSkillWhereInput = {
      ...publicListingWhere(),
    }

    if (category) {
      where.category = category
    }

    if (section === "official") {
      where.trustTier = "OFFICIAL"
    } else if (section === "popular") {
      where.trustTier = { not: "OFFICIAL" }
    } else if (trustTier) {
      const tierHierarchy: Record<string, string[]> = {
        OFFICIAL: ["OFFICIAL"],
        VERIFIED: ["VERIFIED", "OFFICIAL"],
        SCANNED: ["SCANNED", "VERIFIED", "OFFICIAL"],
        UNREVIEWED: ["UNREVIEWED", "SCANNED", "VERIFIED", "OFFICIAL"],
      }
      const tiers = tierHierarchy[trustTier] ?? ["OFFICIAL"]
      where.trustTier = { in: tiers as TrustTier[] }
    }

    if (isFree === true) {
      where.isFree = true
    } else if (isFree === false) {
      where.isFree = false
    }

    if (search && search.trim().length > 0) {
      const result = await searchSkills({
        search: search.trim(),
        category,
        trustTier,
        section,
        isFree,
        sort,
        cursor,
        limit,
      })
      return apiSuccess({
        items: result.items,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
      })
    }

    const orderBy: Prisma.MarketplaceSkillOrderByWithRelationInput = (() => {
      switch (sort) {
        case "newest": return { publishedAt: "desc" as const }
        case "price_asc": return { price: "asc" as const }
        case "price_desc": return { price: "desc" as const }
        case "rating": return { avgRating: "desc" as const }
        case "popular":
        default: return { installCount: "desc" as const }
      }
    })()

    const skills = await prisma.marketplaceSkill.findMany({
      where,
      include: {
        creator: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = skills.length > limit
    const items = skills.slice(0, limit).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      emoji: s.emoji,
      description: s.description,
      category: s.category,
      trustTier: s.trustTier,
      installCount: s.installCount,
      avgRating: s.avgRating,
      isFree: s.isFree,
      price: s.price,
      creator: s.creator,
    }))

    const nextCursor = hasMore && skills.length > limit
      ? skills[limit - 1].id
      : null

    const totalCount = cursor
      ? -1
      : await prisma.marketplaceSkill.count({ where })

    return apiSuccess({ items, nextCursor, totalCount })
  } catch (error) {
    console.error("Marketplace skills error:", error)
    return apiError("MARKETPLACE_ERROR", "Failed to fetch skills", 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isMarketplacePublishEnabled()) {
      return apiError("COMING_SOON", "Skill publishing is coming soon", 403)
    }

    const user = await getSessionUser()
    if (!user) return ERRORS.UNAUTHORIZED()

    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!creatorProfile) {
      return apiError("NOT_ENROLLED", "You must be enrolled as a creator to publish skills", 403)
    }

    const body = await request.json()
    const {
      name, emoji, description, category, tags,
      requiredBins, requiredEnvVars, skillMd, isFree, price,
    } = body as {
      name?: string; emoji?: string; description?: string; category?: string
      tags?: string[]; requiredBins?: string[]; requiredEnvVars?: string[]
      skillMd?: string; isFree?: boolean; price?: number
    }

    if (!name || name.trim().length < 2) return ERRORS.VALIDATION("Name is required (minimum 2 characters)")
    if (name.trim().length > 80) return ERRORS.VALIDATION("Name must be 80 characters or less")
    if (emoji && emoji.length > 4) return ERRORS.VALIDATION("Emoji must be a single emoji character")
    if (!description || description.trim().length < 10) return ERRORS.VALIDATION("Description is required (minimum 10 characters)")
    if (description.length > 1000) return ERRORS.VALIDATION("Description must be 1000 characters or less")
    if (!category || typeof category !== "string" || category.trim().length === 0) return ERRORS.VALIDATION("Category is required")
    if (tags && (!Array.isArray(tags) || tags.length > 5)) return ERRORS.VALIDATION("Tags must be an array of up to 5 strings")
    if (tags && tags.some((t) => typeof t !== "string" || t.length > 30)) return ERRORS.VALIDATION("Each tag must be 30 characters or less")
    if (requiredBins && (!Array.isArray(requiredBins) || requiredBins.length > 20)) return ERRORS.VALIDATION("Maximum 20 required binaries")
    if (requiredBins && requiredBins.some((b) => typeof b !== "string" || b.length > 50)) return ERRORS.VALIDATION("Each binary name must be 50 characters or less")
    if (requiredEnvVars && (!Array.isArray(requiredEnvVars) || requiredEnvVars.length > 20)) return ERRORS.VALIDATION("Maximum 20 required environment variables")
    if (requiredEnvVars) {
      const envVarPattern = /^[A-Z][A-Z0-9_]*$/
      const invalid = requiredEnvVars.filter((v) => typeof v !== "string" || !envVarPattern.test(v))
      if (invalid.length > 0) return ERRORS.VALIDATION(`Environment variable names must be UPPER_SNAKE_CASE. Invalid: ${invalid.join(", ")}`)
    }
    if (!skillMd || skillMd.trim().length < 20) return ERRORS.VALIDATION("SKILL.md content is required (minimum 20 characters)")
    if (skillMd.length > 50000) return ERRORS.VALIDATION("SKILL.md content must be 50,000 characters or less")
    if (!isFree && price != null) {
      if (typeof price !== "number" || price < 5) return ERRORS.VALIDATION("Paid skills must cost at least $5")
      if (price > 999) return ERRORS.VALIDATION("Price cannot exceed $999")
    }

    const scanResult = scanSkillContent(skillMd)

    const skillRegexFindings = scanResult.findings.map(f => ({
      severity: f.severity as "critical" | "warning",
      agentName: name.trim(),
      file: "SKILL.md",
      line: f.line,
      pattern: f.pattern,
      description: f.description,
      matchedText: "",
    }))

    const llmResult = await runLLMSecurityReview([{
      name: name.trim(),
      role: "SKILL",
      soulMd: skillMd,
      agentsMd: "",
    }], skillRegexFindings)

    const llmAvailable = llmResult.summary !== "" && !llmResult.summary.startsWith("LLM review unavailable") && !llmResult.summary.startsWith("LLM security review skipped")
    const overallPassed = llmAvailable ? llmResult.safe : scanResult.passed

    if (!overallPassed) {
      return NextResponse.json({
        success: false,
        error: { code: "SCAN_FAILED", message: "Security scan found issues in SKILL.md content", statusCode: 422 },
        scanPassed: false,
        findings: [
          ...scanResult.findings,
          ...llmResult.findings.filter(f => !f.regexValidation && f.severity === "critical").map(f => ({
            severity: f.severity, pattern: "AI review", line: 0, description: `${f.description} (${f.evidence})`,
          })),
        ],
      }, { status: 422 })
    }

    const slug = await generateUniqueSlug(name.trim(), prisma.marketplaceSkill)

    const skill = await prisma.marketplaceSkill.create({
      data: {
        slug,
        name: sanitizeText(name.trim()),
        emoji: emoji?.trim() || null,
        description: sanitizeText(description.trim()),
        category,
        tags: tags?.map((t) => t.trim()) ?? [],
        skillMd: sanitizeMarkdown(skillMd.trim()),
        requiredBins: requiredBins?.map((b) => b.trim()) ?? [],
        requiredEnvVars: requiredEnvVars?.map((v) => v.trim()) ?? [],
        creatorId: creatorProfile.id,
        isFree: !!isFree,
        price: isFree ? null : (price ?? null),
        trustTier: "UNREVIEWED",
        reviewStatus: "PENDING",
        isPublished: false,
        publishedAt: null,
        version: 1,
        autoScanPassed: scanResult.passed,
        autoScanReport: scanResult.findings.length > 0 ? JSON.stringify(scanResult.findings) : null,
        sandboxPassed: null,
        sandboxReport: null,
      },
    })

    await prisma.creatorProfile.update({
      where: { id: creatorProfile.id },
      data: { totalSkills: { increment: 1 } },
    })

    log.info("Skill submitted for manual review; not listed until approved", {
      category: "marketplace",
      skillId: skill.id,
      skillSlug: skill.slug,
    })

    log.marketplaceEvent({ event: "skill_published", itemId: skill.id, itemType: "skill", userId: user.id })

    return apiSuccess({
      skillId: skill.id,
      slug: skill.slug,
      isPublished: false,
      reviewStatus: "PENDING",
      scanResult: {
        passed: scanResult.passed,
        hasCritical: scanResult.hasCritical,
        hasWarnings: scanResult.hasWarnings,
        findingCount: scanResult.findings.length,
        findings: scanResult.hasWarnings ? scanResult.findings : [],
      },
    }, 201)
  } catch (error) {
    console.error("Skill publish error:", error)
    return apiError("PUBLISH_ERROR", "Failed to publish skill", 500)
  }
}
