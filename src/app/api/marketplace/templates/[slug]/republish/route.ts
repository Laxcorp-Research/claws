import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"
import { buildWorkspaceSnapshotFromWorkspace } from "@/lib/marketplace/workspace-snapshot"
import { validateSkillDependencies } from "@/lib/marketplace/skill-dependency"
import { scanTemplate } from "@/lib/marketplace/template-scan"
import { runLLMSecurityReview } from "@/lib/marketplace/llm-security-review"
import { log } from "@/lib/logger"

/**
 * Owner-only republish: writes pending snapshot + pendingVersion.
 * Live workspaceSnapshot / isPublished stay public until admin approve.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!isMarketplacePublishEnabled()) {
    return apiError("COMING_SOON", "Template publishing is coming soon", 403)
  }

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { slug } = await params
  const body = await request.json()
  const { workspaceId } = body as { workspaceId?: string }
  if (!workspaceId || typeof workspaceId !== "string") {
    return ERRORS.VALIDATION("workspaceId is required")
  }

  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    include: { creator: { select: { userId: true } } },
  })
  if (!template) return ERRORS.NOT_FOUND("Template")
  if (!template.creator || template.creator.userId !== user.id) {
    return apiError("FORBIDDEN", "Only the template owner can republish", 403)
  }
  if (template.trustTier === "OFFICIAL") {
    return apiError("FORBIDDEN", "Official templates cannot be republished by creators", 403)
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      agents: { include: { skills: { include: { skill: true } } } },
      connections: true,
      toolConnections: true,
    },
  })
  if (!workspace || workspace.userId !== user.id) {
    return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
  }
  if (workspace.agents.length === 0) {
    return ERRORS.VALIDATION("Workspace has no agents. Add agents in the builder before republishing.")
  }

  const pendingSnapshot = buildWorkspaceSnapshotFromWorkspace(workspace)
  const parsed = JSON.parse(pendingSnapshot) as Record<string, unknown>
  const skillCheck = await validateSkillDependencies(parsed)
  if (!skillCheck.valid) {
    return ERRORS.VALIDATION(`Template references unavailable skills: ${skillCheck.missing.join(", ")}`)
  }

  const agentsForScan = workspace.agents.map((a) => ({
    name: a.name,
    role: a.role,
    soulMd: a.soulMd,
    agentsMd: a.agentsMd,
    heartbeatMd: a.heartbeatMd || undefined,
  }))
  const scanResult = scanTemplate(agentsForScan)
  const llmResult = await runLLMSecurityReview(agentsForScan, scanResult.findings)
  const llmAvailable =
    llmResult.summary !== "" &&
    !llmResult.summary.startsWith("LLM review unavailable") &&
    !llmResult.summary.startsWith("LLM security review skipped")
  const overallPassed = llmAvailable ? llmResult.safe : scanResult.passed
  if (!overallPassed) {
    return apiError("SCAN_FAILED", "Security scan found critical issues in template content", 422)
  }

  const pendingVersion = template.version + 1
  const updated = await prisma.clawTemplate.update({
    where: { id: template.id },
    data: {
      pendingWorkspaceSnapshot: pendingSnapshot,
      pendingVersion,
      pendingSubmittedAt: new Date(),
      autoScanPassed: overallPassed,
      autoScanReport: JSON.stringify({
        regex: { passed: scanResult.passed, findings: scanResult.findings },
        llm: {
          safe: llmResult.safe,
          riskLevel: llmResult.riskLevel,
          summary: llmResult.summary,
          findings: llmResult.findings,
          available: llmAvailable,
        },
        republish: true,
      }),
      // Live listing unchanged: isPublished + reviewStatus stay as-is.
    },
  })

  log.marketplaceEvent({
    event: "template_republish_submitted",
    itemId: template.id,
    itemType: "template",
    userId: user.id,
  })

  return apiSuccess({
    templateId: updated.id,
    slug: updated.slug,
    liveVersion: updated.version,
    pendingVersion,
    pendingSubmittedAt: updated.pendingSubmittedAt,
    liveStaysPublic: true,
  })
}
