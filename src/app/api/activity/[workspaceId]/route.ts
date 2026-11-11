import { NextRequest } from "next/server"
import { gunzipSync } from "node:zlib"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import { hydratePendingApprovals, respondedRequestIds } from "@/lib/artifacts/pending-approvals"
import { formatActivityLog, type ActivityLogFormatInput } from "@/lib/activity-log-format"
import {
  aggregateAgentCostRow,
  parseCostRange,
  sinceForCostRange,
  utcDayStart,
  type CostRange,
} from "@/lib/activity-cost-display"
import {
  decideNearCapAlert,
  NEAR_CAP_METADATA_CONTAINS,
} from "@/lib/openclaw/near-cap-alert"
import type { ActivityType, Prisma } from "@/generated/prisma/client"
import { HEAL_ATTEMPT_EVENT_KIND } from "@/lib/healing/ledger"
import { readSelfHostDashboardStatus } from "@/lib/openclaw/docker-live-status"
import { log } from "@/lib/logger"

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
        // [\u2014-]: snapshots generated before the em-dash copy sweep still
        // carry the old separator; accept both so paused-state stays readable.
        const match = line.match(/^- Worker (.+) is paused [\u2014-] do not delegate to it\.$/)
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
  // Rule 18: UTC day boundaries only - never local `new Date(y, m, d)`.
  const todayStart = utcDayStart(now)
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)
  const costRange: CostRange = parseCostRange(searchParams.get("costRange"))
  const costRangeSince = sinceForCostRange(costRange, now)

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

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const healedThisWeek = await prisma.activityLog.count({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: weekAgo },
      AND: [
        { metadata: { contains: `"eventKind":"${HEAL_ATTEMPT_EVENT_KIND}"` } },
        { metadata: { contains: `"outcome":"healed"` } },
      ],
    },
  })

  const hasMoreActivity = recentLogs.length > activityLimit
  const activityRows = hasMoreActivity ? recentLogs.slice(0, activityLimit) : recentLogs
  const nextCursor = hasMoreActivity ? encodeCursor(activityRows[activityRows.length - 1]) : null

  let provisioningQueue: { position: number; etaAt: string; reason: string } | null = null
  if (workspace!.status === "PROVISIONING_QUEUED") {
    const queueRow = await prisma.provisioningQueue.findUnique({
      where: { workspaceId },
      select: { enqueuedAt: true, etaAt: true, reason: true },
    })
    if (queueRow) {
      const position = await prisma.provisioningQueue.count({
        where: { enqueuedAt: { lte: queueRow.enqueuedAt } },
      })
      provisioningQueue = {
        position,
        etaAt: queueRow.etaAt.toISOString(),
        reason: queueRow.reason,
      }
    }
  }

  // PR-3 near-cap: newest WARNING event (container emits ERROR + kind state_sync_near_cap)
  // stays unresolved until a later sync drops below re-arm (<70%).
  const [latestNearCapWarning, containerStateRow] = await Promise.all([
    prisma.activityLog.findFirst({
      where: {
        workspaceId,
        actionType: "ERROR",
        metadata: { contains: NEAR_CAP_METADATA_CONTAINS },
      },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    }),
    prisma.containerState.findUnique({
      where: { workspaceId },
      select: {
        runtimeStateUpdatedAt: true,
        runtimeStateSizeBytes: true,
      },
    }),
  ])
  const stateSyncNearCapActive = decideNearCapAlert({
    latestWarning: latestNearCapWarning
      ? { timestamp: latestNearCapWarning.timestamp }
      : null,
    latestSnapshot:
      containerStateRow?.runtimeStateUpdatedAt != null &&
      containerStateRow.runtimeStateSizeBytes != null
        ? {
            updatedAt: containerStateRow.runtimeStateUpdatedAt,
            compressedBytes: containerStateRow.runtimeStateSizeBytes,
          }
        : null,
  })

  const answered = respondedRequestIds(humanResponses)
  const pendingApprovals = await hydratePendingApprovals(
    workspaceId,
    humanRequests.filter((req) => !answered.has(req.id)),
  )

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

  let liveStatus = workspace!.status
  let liveHealth = workspace!.healthStatus
  let deployErrorMessage: string | null = null
  try {
    const live = await readSelfHostDashboardStatus({
      id: workspace!.id,
      status: workspace!.status,
      provider: workspace!.provider,
      containerId: workspace!.containerId,
      containerHost: workspace!.containerHost,
      healthStatus: workspace!.healthStatus,
      lastHealthReason: workspace!.lastHealthReason,
    })
    liveStatus = live.status as typeof liveStatus
    liveHealth = (live.healthStatus ?? workspace!.healthStatus) as typeof liveHealth
    deployErrorMessage = live.errorMessage
  } catch (err) {
    log.warn("dashboard: docker inspect failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // PR-3: status derivation depends on the workspace's REAL healthStatus
  // (written by /api/cron/health-monitor every 2 min) - not the prior
  // tautology that derived "healthy" purely from workspace.status===RUNNING.
  // Order of precedence is intentional:
  //   1. agent.isPaused or workspace.status===PAUSED → "paused" (operator intent)
  //   2. workspace.status !== RUNNING (HIBERNATED, ERROR, STOPPED, etc.) → "offline"
  //   3. workspace.healthStatus===UNHEALTHY → "error" (monitor saw 2+ failures)
  //   4. workspace.healthStatus===DEGRADED → "degraded" (gateway answered but reports
  //      plugin errors / zero agents / bad token / plugin-not-loaded - reachable
  //      but partially broken; surfaced distinctly so operators don't read
  //      "totally down" into a partial outage)
  //   5. otherwise → "healthy"
  const deployedPausedWorkerNames = parseDeployedPauseApplied(latestCompletedDeployment?.configSnapshotGzip)
  const agentStatuses = agents.map((a) => {
    let status: "healthy" | "paused" | "error" | "offline" | "degraded"
    if (a.isPaused || liveStatus === "PAUSED") status = "paused"
    else if (liveStatus !== "RUNNING") status = "offline"
    else if (liveHealth === "UNHEALTHY") status = "error"
    else if (liveHealth === "DEGRADED") status = "degraded"
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
  // (healthy or degraded - degraded is still partially-working). UNHEALTHY
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

  const costBySlug = new Map<string, { calls: number; cost: number }>()
  for (const row of perAgentCosts) {
    costBySlug.set(row.agentSlug, { calls: Number(row.calls), cost: Number(row.cost) })
  }

  const modelBySlug = new Map(agents.map((a) => [a.agentSlug, a.model]))

  /**
   * One aggregation core, three windows: today chip always uses UTC today;
   * costRange=today|7d|all selects the Costs tab / Overview card window.
   * Reuses aggregateAgentCostRow (TASK_COMPLETE calls + MESSAGE_SENT apiCost honesty).
   */
  async function loadCostWindow(since: Date | null) {
    if (agentSlugs.length === 0) {
      return {
        agents: [] as Array<{ agentSlug: string; calls: number; cost: number; isEstimate: boolean }>,
        total: 0,
        totalCalls: 0,
        isEstimate: false,
      }
    }
    const timestampFilter = since ? { gte: since } : undefined
    const [callsByAgent, messageSents] = await Promise.all([
      prisma.activityLog.groupBy({
        by: ["agentSlug"],
        where: {
          workspaceId,
          agentSlug: { in: agentSlugs },
          actionType: "TASK_COMPLETE",
          ...(timestampFilter ? { timestamp: timestampFilter } : {}),
        },
        _count: { _all: true },
      }),
      // MUTATION: widen to non-MESSAGE_SENT → route honesty tests fail.
      prisma.activityLog.findMany({
        where: {
          workspaceId,
          agentSlug: { in: agentSlugs },
          actionType: "MESSAGE_SENT",
          ...(timestampFilter ? { timestamp: timestampFilter } : {}),
        },
        select: { agentSlug: true, apiCost: true },
      }),
    ])

    const callsMap = new Map<string, number>()
    for (const row of callsByAgent) {
      if (!row.agentSlug) continue
      callsMap.set(row.agentSlug, row._count._all)
    }
    const sentsBySlug = new Map<string, Array<{ apiCost: number | null }>>()
    for (const row of messageSents) {
      if (!row.agentSlug) continue
      const list = sentsBySlug.get(row.agentSlug) ?? []
      list.push({ apiCost: row.apiCost })
      sentsBySlug.set(row.agentSlug, list)
    }

    const agentRows = agentSlugs.map((slug) => {
      const resolved = aggregateAgentCostRow({
        model: modelBySlug.get(slug) ?? "",
        taskCompleteCalls: callsMap.get(slug) ?? 0,
        messageSents: sentsBySlug.get(slug) ?? [],
      })
      return { agentSlug: slug, ...resolved }
    })

    const total = Math.round(agentRows.reduce((sum, row) => sum + row.cost, 0) * 100) / 100
    const totalCalls = agentRows.reduce((sum, row) => sum + row.calls, 0)
    const active = agentRows.filter((row) => row.calls > 0 || row.cost > 0)
    const isEstimate = active.length === 0 ? false : active.some((row) => row.isEstimate)
    return { agents: agentRows, total, totalCalls, isEstimate }
  }

  const todayWindow = await loadCostWindow(todayStart)
  const selectedWindow =
    costRange === "today" ? todayWindow : await loadCostWindow(costRangeSince)

  const estimatedCostToday = todayWindow.total
  const estimatedCostTodayCalls = todayWindow.totalCalls
  const estimatedCostTodayIsEstimate = todayWindow.isEstimate

  const totalApiCost = costAgg._sum.apiCost ?? 0
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const dayOfMonth = now.getUTCDate()
  const projectedCost = dayOfMonth > 0 ? (totalApiCost / dayOfMonth) * daysInMonth : 0

  return apiSuccess({
    workspace: {
      id: workspace!.id,
      name: workspace!.name,
      status: liveStatus,
      deployErrorMessage,
      healthStatus: liveHealth,
      // PR-4: the dashboard banner derivation reads these to distinguish
      // config drift (alive-but-misconfigured) from a dead container.
      lastHealthCheck: workspace!.lastHealthCheck ? workspace!.lastHealthCheck.toISOString() : null,
      lastHealthReason: workspace!.lastHealthReason,
      mcpSessionHealthStatus: workspace!.mcpSessionHealthStatus,
      mcpSessionCheckedAt: workspace!.mcpSessionCheckedAt ? workspace!.mcpSessionCheckedAt.toISOString() : null,
      mcpSessionLastError: workspace!.mcpSessionLastError,
      activitySilenceDetectedAt: workspace!.activitySilenceDetectedAt ? workspace!.activitySilenceDetectedAt.toISOString() : null,
      stateSyncStaleDetectedAt: workspace!.stateSyncStaleDetectedAt ? workspace!.stateSyncStaleDetectedAt.toISOString() : null,
      heartbeatMissedAt: workspace!.heartbeatMissedAt ? workspace!.heartbeatMissedAt.toISOString() : null,
      hibernationRefusedAt: workspace!.hibernationRefusedAt ? workspace!.hibernationRefusedAt.toISOString() : null,
      stateSyncNearCapActive,
      currentMonthApiCost: workspace!.currentMonthApiCost,
      apiSpendLimit: workspace!.apiSpendLimit,
      costAlertThreshold: workspace!.costAlertThreshold,
      // PR-B: critical alerts (Telegram/email) opt-out toggle.
      criticalAlertsOptOut: workspace!.criticalAlertsOptOut,
      // PR-C #10: never-hibernate toggle. Must round-trip here - this
      // endpoint's periodic dashboard poll is what would otherwise silently
      // revert the optimistic toggle state back to false.
      alwaysOn: workspace!.alwaysOn,
      apiKeySource,
      provisioningQueue,
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
      estimatedCostTodayIsEstimate,
      pendingReview,
      healedThisWeek,
    },
    costWindow: {
      range: costRange,
      since: costRangeSince ? costRangeSince.toISOString() : null,
      agents: selectedWindow.agents.map((row) => ({
        agentSlug: row.agentSlug,
        calls: row.calls,
        cost: Math.round(row.cost * 100) / 100,
        isEstimate: row.isEstimate,
      })),
      total: selectedWindow.total,
      isEstimate: selectedWindow.isEstimate,
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
