import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId } = await params
  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)

  const [agents, tasksToday, tasksYesterday, pendingReview, costAgg, recentLogs, humanRequests, humanResponses, expiredTools] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId },
      select: { id: true, name: true, role: true, color: true, model: true, agentSlug: true },
    }),
    prisma.activityLog.count({
      where: {
        workspaceId,
        actionType: { in: ["TASK_START", "TASK_COMPLETE", "TASK_FAILED"] },
        timestamp: { gte: todayStart },
      },
    }),
    prisma.activityLog.count({
      where: {
        workspaceId,
        actionType: { in: ["TASK_START", "TASK_COMPLETE", "TASK_FAILED"] },
        timestamp: { gte: yesterdayStart, lt: todayStart },
      },
    }),
    prisma.activityLog.count({
      where: {
        workspaceId,
        actionType: "HUMAN_REQUEST",
        timestamp: { gte: todayStart },
      },
    }),
    prisma.activityLog.aggregate({
      where: { workspaceId, apiCost: { not: null } },
      _sum: { apiCost: true },
    }),
    prisma.activityLog.findMany({
      where: { workspaceId },
      orderBy: { timestamp: "desc" },
      take: 50,
    }),
    prisma.activityLog.findMany({
      where: { workspaceId, actionType: "HUMAN_REQUEST" },
      orderBy: { timestamp: "desc" },
      take: 50,
    }),
    prisma.activityLog.findMany({
      where: { workspaceId, actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] } },
      select: { metadata: true },
    }),
    prisma.toolConnection.findMany({
      where: { workspaceId, status: "ERROR" },
      select: { displayName: true },
    }),
  ])

  const respondedRequestIds = new Set<string>()
  for (const r of humanResponses) {
    try {
      const meta = JSON.parse(r.metadata || "{}")
      if (meta.originalRequestId) respondedRequestIds.add(meta.originalRequestId)
    } catch { /* skip malformed */ }
  }
  const pendingApprovals = humanRequests
    .filter((req) => !respondedRequestIds.has(req.id))
    .map((req) => ({
      id: req.id,
      title: `${req.agentName || "Agent"} requests approval`,
      description: req.action,
      agentName: req.agentName || "Unknown",
      agentSlug: req.agentSlug || "",
      timestamp: req.timestamp.toISOString(),
      metadata: req.metadata,
    }))

  const agentStatuses = agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    color: a.color,
    model: a.model,
    agentSlug: a.agentSlug,
    status: workspace!.status === "PAUSED" ? "paused" as const
      : workspace!.healthStatus === "UNHEALTHY" ? "error" as const
      : workspace!.status === "RUNNING" ? "healthy" as const
      : "offline" as const,
  }))

  const totalApiCost = costAgg._sum.apiCost ?? 0
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const projectedCost = dayOfMonth > 0 ? (totalApiCost / dayOfMonth) * daysInMonth : 0

  return apiSuccess({
    workspace: {
      id: workspace!.id,
      name: workspace!.name,
      status: workspace!.status,
      healthStatus: workspace!.healthStatus,
      currentMonthApiCost: workspace!.currentMonthApiCost,
      apiSpendLimit: workspace!.apiSpendLimit,
      costAlertThreshold: workspace!.costAlertThreshold,
    },
    stats: {
      agentsRunning: agents.length,
      agentsPaused: workspace!.status === "PAUSED" ? agents.length : 0,
      tasksToday,
      tasksYesterday,
      apiCostThisMonth: totalApiCost,
      apiCostProjected: Math.round(projectedCost * 100) / 100,
      pendingReview,
    },
    agents: agentStatuses,
    pendingApprovals,
    spend: {
      thisMonth: workspace!.currentMonthApiCost,
      limit: workspace!.apiSpendLimit,
      percent: workspace!.apiSpendLimit > 0
        ? Math.round((workspace!.currentMonthApiCost / workspace!.apiSpendLimit) * 100)
        : 0,
    },
    expiredTools: expiredTools.map((t) => ({ name: t.displayName })),
    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      agentName: log.agentName ?? "System",
      action: log.action,
      actionType: log.actionType,
      apiCost: log.apiCost,
    })),
  })
}
