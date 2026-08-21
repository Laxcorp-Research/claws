import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { log } from "@/lib/logger"
import { isPubliclyListable } from "@/lib/marketplace/public-visibility"
import { bridgeMarketplaceSkillToSkill } from "@/lib/marketplace/skill-bridge"

/**
 * PR-8 REDEPLOY-CARRIES: install clones Skill + attaches AgentSkill.
 * Runtime materializes on next redeploy (generator writes SKILL.md).
 * Live-container hot-add is a post-launch board item - not claimed here.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await request.json()
  const { workspaceId, agentIds } = body as {
    workspaceId?: string
    agentIds?: string[]
  }

  if (!workspaceId || typeof workspaceId !== "string") {
    return ERRORS.VALIDATION("workspaceId is required")
  }

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
  })
  if (!skill || !isPubliclyListable(skill)) return ERRORS.NOT_FOUND("skill")

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      userId: true,
      status: true,
      agents: {
        select: { id: true, name: true, agentSlug: true, role: true },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!workspace || workspace.userId !== user.id) {
    return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
  }

  const existingInstall = await prisma.skillInstall.findUnique({
    where: { skillId_userId: { skillId: skill.id, userId: user.id } },
  })
  if (existingInstall) {
    return apiError("ALREADY_INSTALLED", "This skill is already installed", 409)
  }

  const isPaid = !skill.isFree && skill.price != null && skill.price > 0
  if (isPaid) {
    const purchase = await prisma.marketplaceSale.findFirst({
      where: { skillId: skill.id, buyerId: user.id },
      select: { id: true },
    })
    if (!purchase) {
      return apiError(
        "PURCHASE_REQUIRED",
        "Purchase required before installing this skill.",
        403,
      )
    }
  }

  const librarySkill = await bridgeMarketplaceSkillToSkill(skill)

  // Agent picker: explicit ids, else default to orchestrator, else first agent.
  let targetAgentIds: string[]
  if (Array.isArray(agentIds) && agentIds.length > 0) {
    const allowed = new Set(workspace.agents.map((a) => a.id))
    targetAgentIds = agentIds.filter((id) => allowed.has(id))
    if (targetAgentIds.length === 0) {
      return ERRORS.VALIDATION("agentIds must belong to the workspace")
    }
  } else {
    const orch = workspace.agents.find((a) => a.role === "ORCHESTRATOR")
    const fallback = orch ?? workspace.agents[0]
    if (!fallback) {
      return ERRORS.VALIDATION("Workspace has no agents to attach the skill to")
    }
    targetAgentIds = [fallback.id]
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentSkill.createMany({
      data: targetAgentIds.map((agentId) => ({
        agentId,
        skillId: librarySkill.id,
      })),
      skipDuplicates: true,
    })

    await tx.skillInstall.create({
      data: { skillId: skill.id, userId: user.id },
    })

    await tx.marketplaceSkill.update({
      where: { id: skill.id },
      data: { installCount: { increment: 1 } },
    })
  })

  log.info(
    `Skill "${skill.slug}" installed - applies on next redeploy (AgentSkill attached)`,
    {
      skillSlug: skill.slug,
      workspaceId: workspace.id,
      agentIds: targetAgentIds,
      librarySkillId: librarySkill.id,
    },
  )

  return apiSuccess(
    {
      installed: true,
      skillSlug: slug,
      workspaceId,
      librarySkillId: librarySkill.id,
      agentIds: targetAgentIds,
      appliesOnNextRedeploy: true,
      message: "Skill attached. Applies on next redeploy.",
    },
    201,
  )
}
