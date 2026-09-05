import { prisma } from "@/lib/db"
import {
  computeApprovalVersionStates,
  type ApprovalDecisionState,
  type ApprovalVersionState,
} from "@/lib/artifacts/approval-version"

export async function supersedeOlderPendingVersions(args: {
  workspaceId: string
  logicalPath: string
  keepFileVersionId: string
}): Promise<number> {
  const result = await prisma.fileVersion.updateMany({
    where: {
      workspaceId: args.workspaceId,
      logicalPath: args.logicalPath,
      id: { not: args.keepFileVersionId },
      decision: "NONE",
    },
    data: { decision: "SUPERSEDED" },
  })
  return result.count
}

export async function loadApprovalVersionStates(args: {
  workspaceId: string
  logicalPaths: string[]
}): Promise<Map<string, ApprovalVersionState>> {
  const paths = [...new Set(args.logicalPaths.filter(Boolean))]
  if (paths.length === 0) return new Map()
  const rows = await prisma.fileVersion.findMany({
    where: { workspaceId: args.workspaceId, logicalPath: { in: paths } },
    select: {
      id: true,
      logicalPath: true,
      version: true,
      createdAt: true,
      decision: true,
    },
  })
  return computeApprovalVersionStates(
    rows.map((row) => ({
      id: row.id,
      logicalPath: row.logicalPath,
      version: typeof row.version === "number" ? row.version : 0,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(0),
      decision: (row.decision ?? "NONE") as ApprovalDecisionState,
    })),
  )
}

export async function reconcileSupersededVersions(args: {
  workspaceId: string
  logicalPaths: string[]
}): Promise<void> {
  const states = await loadApprovalVersionStates(args)
  const staleIds = [...states.entries()]
    .filter(([, state]) => !state.isLatest && state.decision === "SUPERSEDED")
    .map(([id]) => id)
  if (staleIds.length === 0) return
  await prisma.fileVersion.updateMany({
    where: {
      id: { in: staleIds },
      workspaceId: args.workspaceId,
      decision: "NONE",
    },
    data: { decision: "SUPERSEDED" },
  })
}
