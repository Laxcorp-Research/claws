import { prisma } from "@/lib/db"
import { looksLikeApprovalRequest } from "@/lib/openclaw/delivery-rail"

export async function createPendingApprovalFromOutbound(args: {
  workspaceId: string
  action: string
  agentName?: string | null
  agentSlug?: string | null
}): Promise<{ created: boolean; id?: string }> {
  if (!looksLikeApprovalRequest(args.action)) {
    return { created: false }
  }

  const since = new Date(Date.now() - 60 * 60 * 1000)
  const existing = await prisma.activityLog.findFirst({
    where: {
      workspaceId: args.workspaceId,
      actionType: "HUMAN_REQUEST",
      action: args.action,
      timestamp: { gte: since },
    },
    select: { id: true },
  })
  if (existing) return { created: false, id: existing.id }

  const row = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      agentName: args.agentName ?? null,
      agentSlug: args.agentSlug ?? null,
      action: args.action,
      actionType: "HUMAN_REQUEST",
      timestamp: new Date(),
      metadata: JSON.stringify({ eventKind: "delivery_approval_request" }),
    },
    select: { id: true },
  })
  return { created: true, id: row.id }
}
