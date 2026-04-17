import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const body = await req.json()
  const allowed = ["name", "color", "model", "fallbackModel", "soulMd", "agentsMd", "heartbeatMd", "heartbeatFrequency", "heartbeatTime", "toolsMd", "userMd", "qualityThreshold", "maxRetries", "reportsTo", "positionX", "positionY", "roleDescription", "description", "icon"]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (updates.soulMd && (updates.soulMd as string).length > 50000) return ERRORS.VALIDATION("SOUL.md must be under 50,000 characters")
  if (updates.agentsMd && (updates.agentsMd as string).length > 50000) return ERRORS.VALIDATION("AGENTS.md must be under 50,000 characters")

  if (updates.name) {
    updates.agentSlug = (updates.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  }

  const agent = await prisma.agent.update({ where: { id }, data: updates })

  if (Array.isArray(body.skillIds)) {
    await prisma.agentSkill.deleteMany({ where: { agentId: id } })
    if (body.skillIds.length > 0) {
      await prisma.agentSkill.createMany({
        data: (body.skillIds as string[]).map((skillId: string) => ({ agentId: id, skillId })),
        skipDuplicates: true,
      })
    }
  }

  return apiSuccess(agent)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const agent = await prisma.agent.findUnique({ where: { id } })
  if (!agent) return ERRORS.NOT_FOUND("Agent")
  if (agent.role === "ORCHESTRATOR") return ERRORS.ROLE_PROTECTED("Orchestrator")
  if (agent.role === "CRITIC") return ERRORS.ROLE_PROTECTED("Critic")

  await prisma.agent.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
