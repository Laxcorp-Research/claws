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

  if (workspace!.status === "RUNNING") {
    const owner = await prisma.user.findUnique({
      where: { id: user.id },
      select: { trialUsed: true, trialEndsAt: true, hasActiveSubscription: true },
    })
    if (owner?.trialUsed && !owner.hasActiveSubscription) {
      const expired = !owner.trialEndsAt || owner.trialEndsAt <= now
      if (expired) {
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { status: "PAUSED" },
        })
        workspace!.status = "PAUSED"
      }
    }
  }
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)

  const [agents, tasksToday, tasksYesterday, pendingReview, costAgg, recentLogs, humanRequests, humanResponses, expiredTools] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId },
      select: { id: true, name: true, role: true, color: true, model: true, agentSlug: true, isPaused: true, lastActiveAt: true },
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

  const agentSlugs = agents.map((a) => a.agentSlug).filter(Boolean)
  const latestActivityByAgent = agentSlugs.length > 0
    ? await prisma.$queryRawUnsafe<{ agentSlug: string; latest: Date }[]>(
        `SELECT "agentSlug", MAX("timestamp") as latest FROM "ActivityLog" WHERE "workspaceId" = $1 AND "agentSlug" = ANY($2) GROUP BY "agentSlug"`,
        workspaceId,
        agentSlugs,
      )
    : []

  const lastActiveMap = new Map<string, string>()
  for (const row of latestActivityByAgent) {
    lastActiveMap.set(row.agentSlug, new Date(row.latest).toISOString())
  }

  const agentStatuses = agents.map((a) => {
    let status: "healthy" | "paused" | "error" | "offline"
    if (a.isPaused) status = "paused"
    else if (workspace!.status === "PAUSED") status = "paused"
    else if (workspace!.healthStatus === "UNHEALTHY") status = "error"
    else if (workspace!.status === "RUNNING") status = "healthy"
    else status = "offline"

    const lastActive = lastActiveMap.get(a.agentSlug)
      ?? (a.lastActiveAt ? a.lastActiveAt.toISOString() : undefined)

    return {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      model: a.model,
      agentSlug: a.agentSlug,
      status,
      lastActive,
    }
  })

  const pausedCount = agentStatuses.filter((a) => a.status === "paused").length

  const perAgentCosts = agentSlugs.length > 0
    ? await prisma.$queryRawUnsafe<{ agentSlug: string; calls: bigint; cost: number }[]>(
        `SELECT "agentSlug", COUNT(*) as calls, COALESCE(SUM("apiCost"), 0) as cost FROM "ActivityLog" WHERE "workspaceId" = $1 AND "agentSlug" = ANY($2) AND "apiCost" IS NOT NULL GROUP BY "agentSlug"`,
        workspaceId,
        agentSlugs,
      )
    : []

  const costBySlug = new Map<string, { calls: number; cost: number }>()
  for (const row of perAgentCosts) {
    costBySlug.set(row.agentSlug, { calls: Number(row.calls), cost: Number(row.cost) })
  }

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
      agentsRunning: agents.length - pausedCount,
      agentsPaused: pausedCount,
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
    agentCosts: agents.map((a) => {
      const entry = costBySlug.get(a.agentSlug)
      return { agentSlug: a.agentSlug, agentName: a.name, role: a.role, model: a.model, calls: entry?.calls ?? 0, cost: Math.round((entry?.cost ?? 0) * 100) / 100 }
    }),
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
