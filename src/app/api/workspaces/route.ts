import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { DEFAULT_MODEL } from "@/lib/models"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const workspaces = await prisma.workspace.findMany({
    where: { userId: user.id },
    include: {
      _count: { select: { agents: true } },
      agents: { select: { role: true } },
      clawTemplate: { select: { name: true, category: true } },
    },
    orderBy: { updatedAt: "desc" },
  })

  return apiSuccess(workspaces)
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const body = await req.json()
  const { name, templateId } = body

  if (!name || typeof name !== "string" || name.length > 64) {
    return ERRORS.VALIDATION("Name is required and must be under 64 characters")
  }

  const MAX_WORKSPACES = 20
  const workspaceCount = await prisma.workspace.count({ where: { userId: user.id } })
  if (workspaceCount >= MAX_WORKSPACES) return ERRORS.WORKSPACE_LIMIT(MAX_WORKSPACES)

  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const existing = await prisma.workspace.findUnique({
    where: { userId_slug: { userId: user.id, slug: baseSlug } },
  })
  const slug = existing ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug

  if (templateId) {
    const template = await prisma.clawTemplate.findUnique({ where: { id: templateId } })
    if (!template) return ERRORS.NOT_FOUND("Template")

    const snapshot = JSON.parse(template.workspaceSnapshot) as {
      agents: Array<{ name: string; agentSlug: string; role: string; color: string; model: string; soulMd: string; agentsMd: string; heartbeatMd?: string; heartbeatFrequency?: string | null; heartbeatTime?: string | null; positionX: number; positionY: number; qualityThreshold?: number; reportsTo?: string }>
      connections: Array<{ sourceSlug: string; targetSlug: string; condition: string; label?: string }>
    }

    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: { userId: user.id, name, slug, status: "SETUP_INCOMPLETE", clawTemplateId: templateId },
      })

      const agentIdMap: Record<string, string> = {}
      for (const a of snapshot.agents) {
        const agent = await tx.agent.create({
          data: {
            workspaceId: ws.id, name: a.name, agentSlug: a.agentSlug, role: a.role as "ORCHESTRATOR" | "WORKER" | "CRITIC",
            color: a.color, model: a.model, soulMd: a.soulMd, agentsMd: a.agentsMd,
            heartbeatMd: a.heartbeatMd || null,
            heartbeatFrequency: a.heartbeatFrequency ?? null,
            heartbeatTime: a.heartbeatTime ?? null,
            positionX: a.positionX, positionY: a.positionY,
            qualityThreshold: a.qualityThreshold ?? 8.0,
          },
        })
        agentIdMap[a.agentSlug] = agent.id
      }

      for (const a of snapshot.agents) {
        if (a.reportsTo && agentIdMap[a.reportsTo]) {
          await tx.agent.update({ where: { id: agentIdMap[a.agentSlug] }, data: { reportsTo: agentIdMap[a.reportsTo] } })
        }
      }

      for (const c of snapshot.connections) {
        const src = agentIdMap[c.sourceSlug]
        const tgt = agentIdMap[c.targetSlug]
        if (src && tgt) {
          await tx.agentConnection.create({
            data: { workspaceId: ws.id, sourceAgentId: src, targetAgentId: tgt, condition: c.condition as "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE" | "ON_HUMAN_APPROVE" | "CUSTOM", label: c.label || null },
          })
        }
      }

      await tx.workspaceSnapshot.create({
        data: { workspaceId: ws.id, version: 1, snapshot: template.workspaceSnapshot, trigger: "TEMPLATE_LOAD", label: `Original template: ${template.name}` },
      })

      return ws
    })

    const full = await prisma.workspace.findUnique({
      where: { id: workspace.id },
      include: { agents: { orderBy: { createdAt: "asc" } }, connections: true },
    })
    return apiSuccess(full, 201)
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: { userId: user.id, name, slug, status: "DRAFT" },
    })
    const orch = await tx.agent.create({
      data: {
        workspaceId: ws.id, name: "Orchestrator", agentSlug: "orchestrator", role: "ORCHESTRATOR",
        color: "#5BA1F5", model: DEFAULT_MODEL.ORCHESTRATOR,
        soulMd: "# Orchestrator\n\nYou are the team manager. Delegate tasks to workers, collect results, and present approved work to the human.",
        agentsMd: "# Team\n\nCoordinate with all workers and the critic.", positionX: 400, positionY: 50,
      },
    })
    const critic = await tx.agent.create({
      data: {
        workspaceId: ws.id, name: "Quality Critic", agentSlug: "quality-critic", role: "CRITIC",
        color: "#8b5cf6", model: DEFAULT_MODEL.CRITIC,
        soulMd: "# Critic\n\nYou review all work from the team. Score 1-10 and provide actionable feedback.",
        agentsMd: "# Review Standards\n\nApply consistent quality standards across all outputs.",
        positionX: 400, positionY: 450, qualityThreshold: 8.0,
      },
    })
    await tx.agentConnection.create({
      data: { workspaceId: ws.id, sourceAgentId: orch.id, targetAgentId: critic.id, condition: "ON_COMPLETE", label: "On complete" },
    })
    return ws
  })

  const full = await prisma.workspace.findUnique({
    where: { id: workspace.id },
    include: { agents: { orderBy: { createdAt: "asc" } }, connections: true },
  })
  return apiSuccess(full, 201)
}
