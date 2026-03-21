import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const snapshots = await prisma.workspaceSnapshot.findMany({
    where: { workspaceId: id },
    select: { id: true, version: true, trigger: true, label: true, createdAt: true },
    orderBy: { version: "desc" },
    take: 50,
  })
  return apiSuccess(snapshots)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const body = await req.json().catch(() => ({}))

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: { agents: true, connections: true },
  })
  if (!workspace) return ERRORS.NOT_FOUND("Workspace")

  const snapshotData = {
    agents: workspace.agents.map((a) => ({
      name: a.name, agentSlug: a.agentSlug, role: a.role, color: a.color, model: a.model,
      soulMd: a.soulMd, agentsMd: a.agentsMd, heartbeatMd: a.heartbeatMd,
      positionX: a.positionX, positionY: a.positionY, qualityThreshold: a.qualityThreshold,
      reportsTo: a.reportsTo,
    })),
    connections: workspace.connections.map((c) => ({
      sourceSlug: workspace.agents.find((a) => a.id === c.sourceAgentId)?.agentSlug || "",
      targetSlug: workspace.agents.find((a) => a.id === c.targetAgentId)?.agentSlug || "",
      condition: c.condition, label: c.label,
    })),
  }

  const last = await prisma.workspaceSnapshot.findFirst({
    where: { workspaceId: id }, orderBy: { version: "desc" }, select: { version: true },
  })
  const nextVersion = (last?.version ?? 0) + 1

  const snapshot = await prisma.workspaceSnapshot.create({
    data: {
      workspaceId: id, version: nextVersion, snapshot: snapshotData,
      trigger: (body as Record<string, string>).trigger || "AUTO_SAVE",
      label: (body as Record<string, string>).label || null,
    },
  })
  return apiSuccess(snapshot, 201)
}
