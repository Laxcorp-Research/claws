import { prisma } from "@/lib/db"

interface SnapshotAgent {
  agentSlug: string
  name: string
  role: string
  model: string
  soulMd: string
  agentsMd: string
  heartbeatMd?: string
  color?: string
  qualityThreshold?: number
  positionX?: number
  positionY?: number
  reportsTo?: string
}

interface SnapshotConnection {
  sourceSlug: string
  targetSlug: string
  condition: string
}

interface WorkspaceSnapshot {
  agents: SnapshotAgent[]
  connections?: SnapshotConnection[]
}

interface CreateWorkspaceOptions {
  userId: string
  templateId: string
}

interface WorkspaceResult {
  workspaceId: string
  workspaceName: string
}

type AgentRole = "ORCHESTRATOR" | "WORKER" | "CRITIC"
type ConnectionCondition = "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE" | "ON_HUMAN_APPROVE" | "CUSTOM"

/**
 * Creates a Workspace + Agents + AgentConnections from a ClawTemplate snapshot.
 * Also creates a TemplateInstall record and increments ClawTemplate.installCount.
 *
 * Used by: checkout route (mock mode + free templates), webhook (paid templates).
 */
export async function createWorkspaceFromTemplate(
  options: CreateWorkspaceOptions,
): Promise<WorkspaceResult> {
  const { userId, templateId } = options

  const template = await prisma.clawTemplate.findUniqueOrThrow({
    where: { id: templateId },
  })

  const raw = template.workspaceSnapshot
  const snapshot: WorkspaceSnapshot =
    typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as WorkspaceSnapshot)

  return prisma.$transaction(async (tx) => {
    const existingCount = await tx.workspace.count({
      where: { userId, clawTemplateId: template.id },
    })
    const name = existingCount > 0
      ? `${template.name} (${existingCount + 1})`
      : template.name

    const workspace = await tx.workspace.create({
      data: {
        userId,
        name,
        slug: `${template.slug}-${Date.now()}`,
        description: template.description,
        status: "SETUP_INCOMPLETE",
        clawTemplateId: template.id,
      },
    })

    const slugToId: Record<string, string> = {}

    for (const a of snapshot.agents) {
      const agent = await tx.agent.create({
        data: {
          workspaceId: workspace.id,
          agentSlug: a.agentSlug,
          name: a.name,
          role: a.role as AgentRole,
          model: a.model,
          soulMd: a.soulMd,
          agentsMd: a.agentsMd,
          heartbeatMd: a.heartbeatMd ?? null,
          color: a.color ?? "#5BA1F5",
          qualityThreshold: a.qualityThreshold ?? 8.0,
          positionX: a.positionX ?? 0,
          positionY: a.positionY ?? 0,
        },
      })
      slugToId[a.agentSlug] = agent.id
    }

    for (const a of snapshot.agents) {
      if (a.reportsTo && slugToId[a.reportsTo]) {
        await tx.agent.update({
          where: { id: slugToId[a.agentSlug] },
          data: { reportsTo: slugToId[a.reportsTo] },
        })
      }
    }

    for (const c of snapshot.connections ?? []) {
      const src = slugToId[c.sourceSlug]
      const tgt = slugToId[c.targetSlug]
      if (src && tgt) {
        await tx.agentConnection.create({
          data: {
            workspaceId: workspace.id,
            sourceAgentId: src,
            targetAgentId: tgt,
            condition: c.condition as ConnectionCondition,
          },
        })
      }
    }

    await tx.templateInstall.upsert({
      where: { templateId_userId: { templateId: template.id, userId } },
      create: { templateId: template.id, userId },
      update: {},
    })

    await tx.clawTemplate.update({
      where: { id: template.id },
      data: { installCount: { increment: 1 } },
    })

    return { workspaceId: workspace.id, workspaceName: workspace.name }
  })
}
