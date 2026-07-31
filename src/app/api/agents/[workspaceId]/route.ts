import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { DEFAULT_MODEL } from "@/lib/models"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    include: { skills: { include: { skill: true } } },
    orderBy: { createdAt: "asc" },
  })
  return apiSuccess(agents)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const body = await req.json()

  if (body.role === "ORCHESTRATOR" || body.role === "CRITIC") {
    const existing = await prisma.agent.findFirst({ where: { workspaceId, role: body.role } })
    if (existing) return ERRORS.VALIDATION(`Workspace already has a ${body.role.toLowerCase()}`)
  }

  const agentCount = await prisma.agent.count({ where: { workspaceId } })
  if (agentCount >= 10) return ERRORS.AGENT_LIMIT()

  const baseSlug = (body.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const existingSlug = await prisma.agent.findUnique({
    where: { workspaceId_agentSlug: { workspaceId, agentSlug: baseSlug } },
  })
  const agentSlug = existingSlug ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug

  const agent = await prisma.agent.create({
    data: {
      workspaceId, name: body.name || "New Worker", agentSlug,
      role: body.role || "WORKER", color: body.color || "#8BFCAE",
      model: body.model || DEFAULT_MODEL[body.role || "WORKER"] || DEFAULT_MODEL.WORKER,
      soulMd: body.soulMd || "# New Agent\n\nDescribe this agent's identity.",
      agentsMd: body.agentsMd || "# Team\n\nDescribe how this agent works with others.",
      positionX: body.positionX ?? 300, positionY: body.positionY ?? 200,
      // reportsTo is a read-only edge projection — never accept writers.
      qualityThreshold: body.qualityThreshold ?? 8.0,
    },
  })

  // Batch D: persist skillIds on create (builder save previously omitted them).
  if (Array.isArray(body.skillIds) && body.skillIds.length > 0) {
    await prisma.agentSkill.createMany({
      data: (body.skillIds as string[]).map((skillId: string) => ({
        agentId: agent.id,
        skillId,
      })),
      skipDuplicates: true,
    })
  }

  return apiSuccess(agent, 201)
}
