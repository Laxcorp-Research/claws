import { prisma } from "@/lib/db"
import { DELIVERABLE_APPROVAL_EVENT_KIND } from "@/lib/artifacts/deliverable-kind"

/**
 * HUMAN_REQUEST anchored on a FileVersion id (not outbound chat regex).
 * The wave-0 looksLikeApprovalRequest path is retired.
 */
export async function createDeliverableApprovalFromFileVersion(args: {
  workspaceId: string
  fileVersionId: string
  logicalPath: string
  title: string
}): Promise<{ created: boolean; id?: string }> {
  const existing = await prisma.activityLog.findFirst({
    where: {
      workspaceId: args.workspaceId,
      actionType: "HUMAN_REQUEST",
      metadata: { contains: args.fileVersionId },
    },
    select: { id: true },
  })
  if (existing) return { created: false, id: existing.id }

  const row = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      action: `Approval needed: ${args.title}`,
      actionType: "HUMAN_REQUEST",
      timestamp: new Date(),
      metadata: JSON.stringify({
        eventKind: DELIVERABLE_APPROVAL_EVENT_KIND,
        fileVersionId: args.fileVersionId,
        logicalPath: args.logicalPath,
      }),
    },
    select: { id: true },
  })
  return { created: true, id: row.id }
}

export async function findDeliverableApprovalRequest(args: {
  workspaceId: string
  fileVersionId: string
}): Promise<{ id: string } | null> {
  return prisma.activityLog.findFirst({
    where: {
      workspaceId: args.workspaceId,
      actionType: "HUMAN_REQUEST",
      metadata: { contains: args.fileVersionId },
    },
    select: { id: true },
  })
}
