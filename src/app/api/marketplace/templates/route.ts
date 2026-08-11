import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { Prisma, TrustTier, ClawCategory } from "@/generated/prisma/client"
import { scanTemplate } from "@/lib/marketplace/template-scan"
import { runLLMSecurityReview } from "@/lib/marketplace/llm-security-review"
import { validateSkillDependencies } from "@/lib/marketplace/skill-dependency"
import { sanitizeText } from "@/lib/security/sanitize"
import { generateUniqueSlug } from "@/lib/marketplace/slug-utils"
import { log } from "@/lib/logger"
import { searchTemplates } from "@/lib/marketplace/search"
import { formatMarketplaceTemplateRow } from "@/lib/marketplace/format-marketplace-template"
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

    const where: Prisma.ClawTemplateWhereInput = {
      ...publicListingWhere(),
    }

    if (category) {
      where.category = category as ClawCategory
    }

    if (trustTier) {
      const tierHierarchy: Record<string, string[]> = {
        OFFICIAL: ["OFFICIAL"],
        VERIFIED: ["VERIFIED", "OFFICIAL"],
        SCANNED: ["SCANNED", "VERIFIED", "OFFICIAL"],
        UNREVIEWED: ["UNREVIEWED", "SCANNED", "VERIFIED", "OFFICIAL"],
      }
      const tiers = tierHierarchy[trustTier] ?? ["OFFICIAL"]
      where.trustTier = { in: tiers as TrustTier[] }
    }

    if (section === "official") {
      where.trustTier = "OFFICIAL"
    }

    if (isFree === true) {
      where.isFree = true
    } else if (isFree === false) {
      where.isFree = false
      where.price = { gt: 0 }
    }

    if (section === "new") {
      where.trustTier = { not: "OFFICIAL" }
    }

    if (section === "trending" && !(search && search.trim().length > 0)) {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      where.trustTier = { not: "OFFICIAL" }
      where.installs = { some: { createdAt: { gte: sevenDaysAgo } } }

      const trending = await prisma.clawTemplate.findMany({
        where,
        select: {
          id: true, name: true, slug: true, tagline: true, description: true,
          category: true, price: true, isFree: true, trustTier: true,
          installCount: true, avgRating: true, estimatedMonthlyCost: true,
          workspaceSnapshot: true,
          creator: { select: { id: true, displayName: true, avatarUrl: true } },
          _count: {
            select: {
              installs: { where: { createdAt: { gte: sevenDaysAgo } } },
            },
          },
        },
        take: 50,
      })

      const sorted = trending
        .sort((a, b) => (b._count.installs) - (a._count.installs))
        .slice(0, limit)

      const items = sorted.map(({ _count, ...t }) => ({
        ...formatMarketplaceTemplateRow(t),
        recentInstalls: _count.installs,
      }))

      return apiSuccess({ items, nextCursor: null, totalCount: items.length })
    }

    if (search && search.trim().length > 0) {
      const searchSection = section === "trending" ? undefined : section
      const result = await searchTemplates({
        search: search.trim(),
        category,
        trustTier,
        section: searchSection,
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

    const orderBy: Prisma.ClawTemplateOrderByWithRelationInput = (() => {
      switch (sort) {
        case "newest": return { createdAt: "desc" as const }
        case "price_asc": return { price: "asc" as const }
        case "price_desc": return { price: "desc" as const }
        case "rating": return { avgRating: "desc" as const }
        case "popular":
        default: return { installCount: "desc" as const }
      }
    })()

    const templates = await prisma.clawTemplate.findMany({
      where,
      select: {
        id: true, name: true, slug: true, tagline: true, description: true,
        category: true, price: true, isFree: true, trustTier: true,
        installCount: true, avgRating: true, estimatedMonthlyCost: true,
        workspaceSnapshot: true,
        creator: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = templates.length > limit
    const items = templates.slice(0, limit).map((t) => formatMarketplaceTemplateRow(t))
    const nextCursor = hasMore && templates.length > limit
      ? templates[limit - 1].id
      : null

    const totalCount = cursor
      ? -1
      : await prisma.clawTemplate.count({ where })

    return apiSuccess({ items, nextCursor, totalCount })
  } catch (error) {
    console.error("Marketplace templates error:", error)
    return apiError("MARKETPLACE_ERROR", "Failed to fetch templates", 500)
  }
}

const VALID_CATEGORIES: ClawCategory[] = ["MONEY_MAKING", "CREATOR", "BUSINESS_OPS", "VERTICAL", "LIFESTYLE"]

export async function POST(request: NextRequest) {
  try {
    if (!isMarketplacePublishEnabled()) {
      return apiError("COMING_SOON", "Template publishing is coming soon", 403)
    }

    const user = await getSessionUser()
    if (!user) return ERRORS.UNAUTHORIZED()

    const creatorProfile = await prisma.creatorProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!creatorProfile) {
      return apiError("NOT_ENROLLED", "You must be enrolled as a creator to publish templates", 403)
    }

    const body = await request.json()
    const {
      name, tagline, description, category, tags,
      estimatedMonthlyCost, isFree, price, workspaceId,
    } = body as {
      name?: string; tagline?: string; description?: string; category?: string
      tags?: string[]; estimatedMonthlyCost?: string; isFree?: boolean
      price?: number; workspaceId?: string
    }

    if (!name || name.trim().length < 3) return ERRORS.VALIDATION("Name is required (minimum 3 characters)")
    if (name.trim().length > 100) return ERRORS.VALIDATION("Name must be 100 characters or less")
    if (!tagline || tagline.trim().length < 5) return ERRORS.VALIDATION("Tagline is required (minimum 5 characters)")
    if (tagline.trim().length > 100) return ERRORS.VALIDATION("Tagline must be 100 characters or less")
    if (!description || description.trim().length < 20) return ERRORS.VALIDATION("Description is required (minimum 20 characters)")
    if (description.length > 5000) return ERRORS.VALIDATION("Description must be 5000 characters or less")
    if (!category || !VALID_CATEGORIES.includes(category as ClawCategory)) {
      return ERRORS.VALIDATION(`Category must be one of: ${VALID_CATEGORIES.join(", ")}`)
    }
    if (tags && (!Array.isArray(tags) || tags.length > 5)) return ERRORS.VALIDATION("Tags must be an array of up to 5 strings")
    if (tags && tags.some((t) => typeof t !== "string" || t.length > 30)) return ERRORS.VALIDATION("Each tag must be 30 characters or less")
    if (!isFree && price != null) {
      if (typeof price !== "number" || price < 19) return ERRORS.VALIDATION("Paid templates must cost at least $19")
      if (price > 9999) return ERRORS.VALIDATION("Price cannot exceed $9,999")
    }

    const nameConflict = await prisma.clawTemplate.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" }, trustTier: "OFFICIAL" },
      select: { name: true },
    })
    if (nameConflict) {
      return apiError("NAME_CONFLICT", `Template name "${name.trim()}" conflicts with official template "${nameConflict.name}"`, 409)
    }

    if (!workspaceId || typeof workspaceId !== "string") return ERRORS.VALIDATION("workspaceId is required")

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        agents: {
          include: { skills: { include: { skill: true } } },
        },
        connections: true,
        toolConnections: true,
      },
    })

    if (!workspace || workspace.userId !== user.id) {
      return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
    }
    if (workspace.agents.length === 0) {
      return ERRORS.VALIDATION("Workspace has no agents. Add agents in the builder before publishing.")
    }

    const workspaceSnapshot = JSON.stringify({
      agents: workspace.agents.map((a) => ({
        name: a.name,
        agentSlug: a.agentSlug,
        role: a.role,
        roleDescription: a.roleDescription,
        description: a.description,
        color: a.color,
        icon: a.icon,
        soulMd: a.soulMd,
        agentsMd: a.agentsMd,
        heartbeatMd: a.heartbeatMd,
        heartbeatFrequency: a.heartbeatFrequency,
        heartbeatTime: a.heartbeatTime,
        toolsMd: a.toolsMd,
        userMd: a.userMd,
        identityMd: a.identityMd,
        model: a.model,
        fallbackModel: a.fallbackModel,
        reportsTo: a.reportsTo,
        maxRetries: a.maxRetries,
        qualityThreshold: a.qualityThreshold,
        positionX: a.positionX,
        positionY: a.positionY,
        skills: a.skills.map((s) => ({
          slug: s.skill.slug,
          name: s.skill.name,
          configOverrides: s.configOverrides,
        })),
      })),
      connections: workspace.connections.map((c) => ({
        sourceAgentId: c.sourceAgentId,
        targetAgentId: c.targetAgentId,
        sourceSlug: workspace.agents.find((a) => a.id === c.sourceAgentId)?.agentSlug,
        targetSlug: workspace.agents.find((a) => a.id === c.targetAgentId)?.agentSlug,
        condition: c.condition,
        conditionExpr: c.conditionExpr,
        label: c.label,
      })),
      tools: workspace.toolConnections.map((t) => ({
        slug: t.toolSlug,
        name: t.displayName,
        connectionType: t.connectionType,
        required: true,
      })),
    })

    const parsedSnapshot = JSON.parse(workspaceSnapshot) as Record<string, unknown>
    const skillCheck = await validateSkillDependencies(parsedSnapshot)
    if (!skillCheck.valid) {
      return ERRORS.VALIDATION(`Template references unavailable skills: ${skillCheck.missing.join(", ")}`)
    }

    const agentsForScan = workspace.agents.map((a) => ({
      name: a.name, role: a.role, soulMd: a.soulMd, agentsMd: a.agentsMd, heartbeatMd: a.heartbeatMd || undefined,
    }))

    const scanResult = scanTemplate(agentsForScan)
    const llmResult = await runLLMSecurityReview(agentsForScan, scanResult.findings)

    const llmAvailable = llmResult.summary !== "" && !llmResult.summary.startsWith("LLM review unavailable") && !llmResult.summary.startsWith("LLM security review skipped")
    const overallPassed = llmAvailable ? llmResult.safe : scanResult.passed

    if (!overallPassed) {
      const allFindings = [
        ...scanResult.findings,
        ...llmResult.findings.filter(f => !f.regexValidation).map(f => ({
          severity: f.severity, agentName: f.agentName, file: f.file, line: 0, pattern: "AI review" as const, description: f.description, matchedText: f.evidence,
        })),
      ]
      return NextResponse.json({
        success: false,
        error: {
          code: "SCAN_FAILED",
          message: "Security scan found critical issues in template content",
          statusCode: 422,
        },
        scanPassed: false,
        findings: allFindings.filter(f => f.severity === "critical"),
        allFindings,
      }, { status: 422 })
    }

    const slug = await generateUniqueSlug(name.trim(), prisma.clawTemplate)

    const template = await prisma.clawTemplate.create({
      data: {
        name: sanitizeText(name.trim()),
        slug,
        tagline: sanitizeText(tagline.trim()),
        description: sanitizeText(description.trim()),
        category: category as ClawCategory,
        tags: tags?.map((t) => t.trim()) ?? [],
        estimatedMonthlyCost: estimatedMonthlyCost?.trim() ?? null,
        isFree: !!isFree,
        price: isFree ? 0 : (price ?? 0),
        creatorId: creatorProfile.id,
        trustTier: "UNREVIEWED",
        reviewStatus: "PENDING",
        isPublished: false,
        agentCount: workspace.agents.length,
        workspaceSnapshot,
        version: 1,
        autoScanPassed: overallPassed,
        autoScanReport: JSON.stringify({
          regex: { passed: scanResult.passed, findings: scanResult.findings },
          llm: { safe: llmResult.safe, riskLevel: llmResult.riskLevel, summary: llmResult.summary, findings: llmResult.findings, available: llmAvailable },
        }),
        reviewNotes: (scanResult.findings.length > 0 || llmResult.findings.length > 0)
          ? JSON.stringify({ autoScan: scanResult.findings, llmReview: llmResult.findings })
          : null,
      },
    })

    await prisma.creatorProfile.update({
      where: { id: creatorProfile.id },
      data: { totalTemplates: { increment: 1 } },
    })

    log.marketplaceEvent({ event: "template_published", itemId: template.id, itemType: "template", userId: user.id })

    return apiSuccess({
      templateId: template.id,
      slug: template.slug,
      isPublished: false,
      reviewStatus: "PENDING",
      scanResult: {
        passed: scanResult.passed,
        hasWarnings: scanResult.hasWarnings,
        findingCount: scanResult.findings.length,
      },
    }, 201)
  } catch (error) {
    console.error("Template publish error:", error)
    return apiError("PUBLISH_ERROR", "Failed to publish template", 500)
  }
}
