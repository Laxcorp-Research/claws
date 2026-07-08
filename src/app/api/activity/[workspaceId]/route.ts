import { NextRequest } from "next/server"
import { gunzipSync } from "node:zlib"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import { sanitizeActivityText } from "@/lib/security/sanitize"
import { getModelCost } from "@/lib/models"
import { formatActivityLog, type ActivityLogFormatInput } from "@/lib/activity-log-format"
import type { ActivityType, Prisma } from "@/generated/prisma/client"

const MAX_ACTIVITY_LIMIT = 50
const ACTIVITY_TYPES = new Set<string>([
  "HEARTBEAT",
  "TASK_START",
  "TASK_COMPLETE",
  "TASK_FAILED",
  "REVIEW_PASS",
  "REVIEW_REJECT",
  "HUMAN_REQUEST",
  "HUMAN_APPROVE",
  "HUMAN_REJECT",
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "SKILL_INVOKED",
  "ERROR",
  "SYSTEM",
  "COST_ALERT",
  "TRADE_SIGNAL",
  "TRADE_RECOMMENDED",
  "TRADE_EXECUTED",
  "TRADE_SKIPPED",
  "CIRCUIT_BREAKER",
])

type DeployedSnapshot = {
  workspaces?: Record<string, { "TOOLS.md"?: string }>
}

function parseDeployedPauseApplied(configSnapshotGzip: Uint8Array | Buffer | null | undefined): Set<string> {
  const applied = new Set<string>()
  if (!configSnapshotGzip) return applied
  try {
    const raw = gunzipSync(Buffer.from(configSnapshotGzip)).toString("utf8")
    const snapshot = JSON.parse(raw) as DeployedSnapshot
    for (const workspaceFiles of Object.values(snapshot.workspaces ?? {})) {
      const toolsMd = workspaceFiles["TOOLS.md"]
      if (typeof toolsMd !== "string") continue
      for (const line of toolsMd.split("\n")) {
        const match = line.match(/^- Worker (.+) is paused — do not delegate to it\.$/)
        if (match?.[1]) applied.add(match[1])
      }
    }
  } catch {
    return new Set()
  }
  return applied
}

function parseLimit(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_ACTIVITY_LIMIT
  return Math.min(Math.floor(parsed), MAX_ACTIVITY_LIMIT)
}

function parseDateParam(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseActionTypes(searchParams: URLSearchParams): ActivityType[] {
  const raw = [
    ...searchParams.getAll("actionType"),
    ...searchParams.getAll("actionType[]"),
    ...searchParams.getAll("actionTypes"),
  ].flatMap((value) => value.split(","))
  return raw
    .map((value) => value.trim())
    .filter((value): value is ActivityType => ACTIVITY_TYPES.has(value))
}

function encodeCursor(row: { timestamp: Date; id: string }): string {
  return Buffer.from(`${row.timestamp.toISOString()}|${row.id}`, "utf8").toString("base64url")
}

function decodeCursor(cursor: string | null): { timestamp: Date; id: string } | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8")
    const [timestampRaw, id] = decoded.split("|")
    const timestamp = new Date(timestampRaw)
    if (!id || Number.isNaN(timestamp.getTime())) return null
    return { timestamp, id }
  } catch {
    return null
  }
}

function buildActivityWhere(
  workspaceId: string,
  searchParams: URLSearchParams,
): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = { workspaceId }
  const agentSlug = searchParams.get("agentSlug")?.trim()
  const channelId = searchParams.get("channelId")?.trim()
  const q = searchParams.get("q")?.trim()
  const actionTypes = parseActionTypes(searchParams)
  const since = parseDateParam(searchParams.get("since"))
  const until = parseDateParam(searchParams.get("until"))
  const cursor = decodeCursor(searchParams.get("cursor"))

  if (agentSlug) where.agentSlug = agentSlug
  if (channelId) {
    // K2: channel filtering must stay on the extracted/indexed column.
    where.channelId = channelId
  }
  if (actionTypes.length > 0) where.actionType = { in: actionTypes }
  if (q) where.action = { contains: q, mode: "insensitive" }
  if (since || until || cursor) {
    where.AND = [
      ...(where.AND && Array.isArray(where.AND) ? where.AND : []),
      ...(since || until ? [{ timestamp: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }] : []),
      ...(cursor ? [{
        OR: [
          { timestamp: { lt: cursor.timestamp } },
          { timestamp: cursor.timestamp, id: { lt: cursor.id } },
        ],
      }] : []),
    ]
  }

  return where
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId } = await params
  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const now = new Date()
  const searchParams = req.nextUrl.searchParams
  const activityLimit = parseLimit(searchParams.get("limit"))
  const activityWhere = buildActivityWhere(workspaceId, searchParams)

  const owner = await prisma.user.findUnique({
    where: { id: user.id },
    select: { apiKeySource: true },
  })

  const apiKeySource = getApiKeySource(workspace!, owner)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)

  const [agents, tasksToday, tasksYesterday, pendingReview, costAgg, recentLogs, humanRequests, humanResponses, expiredTools, latestCompletedDeployment] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId },
      select: { id: true, name: true, role: true, color: true, model: true, agentSlug: true, isPaused: true, lastActiveAt: true },
    }),
    prisma.activityLog.count({
      where: {
        workspaceId,
        actionType: "TASK_COMPLETE",
        timestamp: { gte: todayStart },
      },
    }),
    prisma.activityLog.count({
      where: {
        workspaceId,
        actionType: "TASK_COMPLETE",
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
      where: activityWhere,
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: activityLimit + 1,
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
    // PR #4 Commit 6: expand the expired-tools banner trigger to cover
    // EXPIRED and REVOKED alongside ERROR. Prior code fired only on ERROR,
    // so any OAuth connection that lapsed (and was correctly written to
    // the DB as EXPIRED after the mapComposioStatus un-collapse in the
    // same commit) would never surface on the dashboard. Also selects
    // `status` + `connectionType` so the dashboard banner can pick the
    // right "Your OAuth token has expired" vs generic "Your connection
    // stopped working" cause sentence.
    prisma.toolConnection.findMany({
      where: { workspaceId, status: { in: ["ERROR", "EXPIRED", "REVOKED"] } },
      select: { displayName: true, status: true, connectionType: true },
    }),
    prisma.deployment.findFirst({
      where: { workspaceId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { configSnapshotGzip: true },
    }),
  ])

  const hasMoreActivity = recentLogs.length > activityLimit
  const activityRows = hasMoreActivity ? recentLogs.slice(0, activityLimit) : recentLogs
  const nextCursor = hasMoreActivity ? encodeCursor(activityRows[activityRows.length - 1]) : null

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
      description: sanitizeActivityText(req.action),
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

  // PR-3: status derivation depends on the workspace's REAL healthStatus
  // (written by /api/cron/health-monitor every 2 min) — not the prior
  // tautology that derived "healthy" purely from workspace.status===RUNNING.
  // Order of precedence is intentional:
  //   1. agent.isPaused or workspace.status===PAUSED → "paused" (operator intent)
  //   2. workspace.status !== RUNNING (HIBERNATED, ERROR, STOPPED, etc.) → "offline"
  //   3. workspace.healthStatus===UNHEALTHY → "error" (monitor saw 2+ failures)
  //   4. workspace.healthStatus===DEGRADED → "degraded" (gateway answered but reports
  //      plugin errors / zero agents / bad token / plugin-not-loaded — reachable
  //      but partially broken; surfaced distinctly so operators don't read
  //      "totally down" into a partial outage)
  //   5. otherwise → "healthy"
  const deployedPausedWorkerNames = parseDeployedPauseApplied(latestCompletedDeployment?.configSnapshotGzip)
  const agentStatuses = agents.map((a) => {
    let status: "healthy" | "paused" | "error" | "offline" | "degraded"
    if (a.isPaused || workspace!.status === "PAUSED") status = "paused"
    else if (workspace!.status !== "RUNNING") status = "offline"
    else if (workspace!.healthStatus === "UNHEALTHY") status = "error"
    else if (workspace!.healthStatus === "DEGRADED") status = "degraded"
    else status = "healthy"

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
      isPaused: a.isPaused,
      pauseApplied: a.role === "WORKER" ? deployedPausedWorkerNames.has(a.name) : false,
      lastActive,
    }
  })

  const pausedCount = agentStatuses.filter((a) => a.status === "paused").length
  // PR-3: prior code returned `agents.length - pausedCount`, which counted
  // "running" agents even when workspace.healthStatus===UNHEALTHY. With
  // honest health data, count only agents that are actually contributing
  // (healthy or degraded — degraded is still partially-working). UNHEALTHY
  // / offline / paused agents are excluded.
  const agentsRunningCount = agentStatuses.filter(
    (a) => a.status === "healthy" || a.status === "degraded",
  ).length
  // PR-4: full per-status breakdown so the StatCard subtext can tell the
  // truth (precedence error > offline > degraded > paused > healthy) instead
  // of the hardcoded "All healthy". pausedCount above is reused as agentsPaused.
  const agentsError = agentStatuses.filter((a) => a.status === "error").length
  const agentsOffline = agentStatuses.filter((a) => a.status === "offline").length
  const agentsDegraded = agentStatuses.filter((a) => a.status === "degraded").length

  const perAgentCosts = agentSlugs.length > 0
    ? await prisma.$queryRawUnsafe<{ agentSlug: string; calls: bigint; cost: number }[]>(
        `SELECT "agentSlug", COUNT(*) as calls, COALESCE(SUM("apiCost"), 0) as cost FROM "ActivityLog" WHERE "workspaceId" = $1 AND "agentSlug" = ANY($2) AND "apiCost" IS NOT NULL GROUP BY "agentSlug"`,
        workspaceId,
        agentSlugs,
      )
    : []

  const todayCallsByAgent = agentSlugs.length > 0
    ? await prisma.activityLog.groupBy({
        by: ["agentSlug"],
        where: {
          workspaceId,
          agentSlug: { in: agentSlugs },
          actionType: "TASK_COMPLETE",
          timestamp: { gte: todayStart },
        },
        _count: { _all: true },
      })
    : []

  const costBySlug = new Map<string, { calls: number; cost: number }>()
  for (const row of perAgentCosts) {
    costBySlug.set(row.agentSlug, { calls: Number(row.calls), cost: Number(row.cost) })
  }

  const modelBySlug = new Map(agents.map((a) => [a.agentSlug, a.model]))
  let estimatedCostToday = 0
  let estimatedCostTodayCalls = 0
  for (const row of todayCallsByAgent) {
    if (!row.agentSlug) continue
    const calls = row._count._all
    estimatedCostTodayCalls += calls
    estimatedCostToday += calls * getModelCost(modelBySlug.get(row.agentSlug) ?? "")
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
      // PR-4: the dashboard banner derivation reads these to distinguish
      // config drift (alive-but-misconfigured) from a dead container.
      lastHealthCheck: workspace!.lastHealthCheck ? workspace!.lastHealthCheck.toISOString() : null,
      lastHealthReason: workspace!.lastHealthReason,
      mcpSessionHealthStatus: workspace!.mcpSessionHealthStatus,
      mcpSessionCheckedAt: workspace!.mcpSessionCheckedAt ? workspace!.mcpSessionCheckedAt.toISOString() : null,
      mcpSessionLastError: workspace!.mcpSessionLastError,
      activitySilenceDetectedAt: workspace!.activitySilenceDetectedAt ? workspace!.activitySilenceDetectedAt.toISOString() : null,
      stateSyncStaleDetectedAt: workspace!.stateSyncStaleDetectedAt ? workspace!.stateSyncStaleDetectedAt.toISOString() : null,
      currentMonthApiCost: workspace!.currentMonthApiCost,
      apiSpendLimit: workspace!.apiSpendLimit,
      costAlertThreshold: workspace!.costAlertThreshold,
      apiKeySource,
    },
    stats: {
      agentsRunning: agentsRunningCount,
      agentsPaused: pausedCount,
      // PR-4: per-status counts for the truthful StatCard subtext.
      agentsError,
      agentsOffline,
      agentsDegraded,
      tasksToday,
      tasksYesterday,
      apiCostThisMonth: totalApiCost,
      apiCostProjected: Math.round(projectedCost * 100) / 100,
      estimatedCostToday: Math.round(estimatedCostToday * 100) / 100,
      estimatedCostTodayCalls,
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
    expiredTools: expiredTools.map((t) => ({
      name: t.displayName,
      status: t.status,
      connectionType: t.connectionType,
    })),
    activityPage: {
      hasMore: hasMoreActivity,
      nextCursor,
      limit: activityLimit,
    },
    recentLogs: activityRows.map((log) => formatActivityLog(log as ActivityLogFormatInput)),
  })
}
