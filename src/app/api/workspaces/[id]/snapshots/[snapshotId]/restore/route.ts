import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id, snapshotId } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const snapshot = await prisma.workspaceSnapshot.findUnique({ where: { id: snapshotId } })
  if (!snapshot || snapshot.workspaceId !== id) return ERRORS.NOT_FOUND("Snapshot")

  const data = (typeof snapshot.snapshot === "string" ? JSON.parse(snapshot.snapshot) : snapshot.snapshot) as {
    agents: Array<{ name: string; agentSlug: string; role: string; color: string; model: string; soulMd: string; agentsMd: string; heartbeatMd?: string; positionX: number; positionY: number; qualityThreshold?: number; reportsTo?: string }>
    connections: Array<{ sourceSlug: string; targetSlug: string; condition: string; label?: string }>
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentConnection.deleteMany({ where: { workspaceId: id } })
    await tx.agent.deleteMany({ where: { workspaceId: id } })

    const agentIdMap: Record<string, string> = {}
    for (const a of data.agents) {
      const agent = await tx.agent.create({
        data: {
          workspaceId: id, name: a.name, agentSlug: a.agentSlug,
          role: a.role as "ORCHESTRATOR" | "WORKER" | "CRITIC",
          color: a.color, model: a.model, soulMd: a.soulMd, agentsMd: a.agentsMd,
          heartbeatMd: a.heartbeatMd || null, positionX: a.positionX, positionY: a.positionY,
          qualityThreshold: a.qualityThreshold ?? 8.0,
        },
      })
      agentIdMap[a.agentSlug] = agent.id
    }

    for (const a of data.agents) {
      if (a.reportsTo && agentIdMap[a.reportsTo]) {
        await tx.agent.update({ where: { id: agentIdMap[a.agentSlug] }, data: { reportsTo: agentIdMap[a.reportsTo] } })
      }
    }

    for (const c of data.connections) {
      const src = agentIdMap[c.sourceSlug]
      const tgt = agentIdMap[c.targetSlug]
      if (src && tgt) {
        await tx.agentConnection.create({
          data: { workspaceId: id, sourceAgentId: src, targetAgentId: tgt, condition: c.condition as "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE" | "ON_HUMAN_APPROVE" | "CUSTOM", label: c.label || null },
        })
      }
    }
  })

  const restored = await prisma.workspace.findUnique({
    where: { id },
    include: { agents: { orderBy: { createdAt: "asc" } }, connections: true },
  })
  return apiSuccess(restored)
}
