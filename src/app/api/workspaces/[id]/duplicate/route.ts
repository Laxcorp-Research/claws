import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encryptedSyncSecret } from "@/lib/openclaw/sync-secret"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error, workspace: source } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()
  if (!source) return ERRORS.NOT_FOUND("Workspace")

  const full = await prisma.workspace.findUnique({
    where: { id }, include: { agents: true, connections: true },
  })
  if (!full) return ERRORS.NOT_FOUND("Workspace")

  const newSlug = `${source.slug}-copy-${Date.now().toString(36)}`

  const ws = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: { userId: user.id, name: `${source.name} (Copy)`, slug: newSlug, status: "DRAFT", clawTemplateId: source.clawTemplateId, syncSecretEncrypted: encryptedSyncSecret() },
    })

    const agentIdMap: Record<string, string> = {}
    for (const a of full.agents) {
      const newAgent = await tx.agent.create({
        data: {
          workspaceId: created.id, name: a.name, agentSlug: a.agentSlug, role: a.role,
          color: a.color, model: a.model, soulMd: a.soulMd, agentsMd: a.agentsMd,
          heartbeatMd: a.heartbeatMd,
          heartbeatFrequency: a.heartbeatFrequency,
          heartbeatTime: a.heartbeatTime,
          positionX: a.positionX, positionY: a.positionY,
          qualityThreshold: a.qualityThreshold, reportsTo: null,
        },
      })
      agentIdMap[a.id] = newAgent.id
    }

    for (const a of full.agents) {
      if (a.reportsTo && agentIdMap[a.reportsTo]) {
        await tx.agent.update({ where: { id: agentIdMap[a.id] }, data: { reportsTo: agentIdMap[a.reportsTo] } })
      }
    }

    for (const c of full.connections) {
      const src = agentIdMap[c.sourceAgentId]
      const tgt = agentIdMap[c.targetAgentId]
      if (src && tgt) {
        await tx.agentConnection.create({
          data: { workspaceId: created.id, sourceAgentId: src, targetAgentId: tgt, condition: c.condition, label: c.label },
        })
      }
    }

    return created
  })

  const result = await prisma.workspace.findUnique({
    where: { id: ws.id }, include: { agents: { orderBy: { createdAt: "asc" } }, connections: true },
  })
  return apiSuccess(result, 201)
}
