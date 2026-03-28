import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await request.json()
  const { workspaceId } = body as { workspaceId?: string }

  if (!workspaceId || typeof workspaceId !== "string") {
    return ERRORS.VALIDATION("workspaceId is required")
  }

  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
  })
  if (!skill || !skill.isPublished) return ERRORS.NOT_FOUND("skill")

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      userId: true,
      status: true,
      containerName: true,
      containerId: true,
      agents: { select: { id: true, name: true, agentSlug: true } },
    },
  })

  if (!workspace || workspace.userId !== user.id) {
    return apiError("FORBIDDEN", "Workspace not found or access denied", 403)
  }

  if (workspace.status !== "RUNNING") {
    return ERRORS.VALIDATION("Workspace must be running to install skills. Deploy it first.")
  }

  const existingInstall = await prisma.skillInstall.findUnique({
    where: { skillId_userId: { skillId: skill.id, userId: user.id } },
  })
  if (existingInstall) {
    return apiError("ALREADY_INSTALLED", "This skill is already installed", 409)
  }

  // TODO: Hot-add skill to running container via Docker exec
  // The deployer.ts has Docker infrastructure but no exported exec helper for skill injection.
  // When container hosting is live (Tier 3), implement:
  //   1. For each agent: mkdir -p /home/node/.openclaw/workspace-{agentSlug}/skills/{slug}
  //   2. Write SKILL.md to each agent's skills directory
  //   3. Update openclaw.json skills.entries.{slug} = { enabled: true }
  //   4. Gateway auto-detects config change and hot-reloads
  const containerName = workspace.containerName ?? workspace.containerId
  if (containerName) {
    console.log(
      `[SKILL_INSTALL] Would hot-add skill "${skill.slug}" to container "${containerName}" ` +
      `for ${workspace.agents.length} agents`
    )
  } else {
    console.warn(
      `[SKILL_INSTALL] Skill "${skill.slug}" installed to workspace "${workspace.id}" ` +
      `(DB only — no container available)`
    )
  }

  await prisma.skillInstall.create({
    data: { skillId: skill.id, userId: user.id },
  })

  await prisma.marketplaceSkill.update({
    where: { id: skill.id },
    data: { installCount: { increment: 1 } },
  })

  return apiSuccess({ installed: true, skillSlug: slug, workspaceId }, 201)
}
