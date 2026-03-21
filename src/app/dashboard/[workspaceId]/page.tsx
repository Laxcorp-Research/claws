"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { OctagonX, Pause, Unplug, TrendingUp } from "lucide-react"
import { StatCards } from "@/components/dashboard/stat-cards"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { AgentStatusList } from "@/components/dashboard/agent-status-list"
import { CostBreakdownTable } from "@/components/dashboard/cost-breakdown-table"
import { PendingApprovals } from "@/components/dashboard/pending-approvals"

interface DashboardStats {
  agentsRunning: number
  agentsPaused: number
  tasksToday: number
  tasksYesterday: number
  apiCostThisMonth: number
  apiCostProjected: number
  pendingReview: number
}

interface WorkspaceInfo {
  id: string
  name: string
  status: string
  healthStatus: string
  currentMonthApiCost: number
  apiSpendLimit: number
  costAlertThreshold: number
}

interface AgentInfo {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  model: string
  agentSlug: string
  status: "healthy" | "paused" | "error" | "offline"
}

interface LogEntry {
  id: string
  timestamp: string
  agentName: string
  agentSlug?: string
  action: string
  actionType: string
  apiCost?: number
}

interface PendingApprovalItem {
  id: string
  title: string
  description: string
  agentName: string
  agentSlug: string
  timestamp: string
}

interface SpendInfo {
  thisMonth: number
  limit: number
  percent: number
}

interface ExpiredTool {
  name: string
}

const AGENT_COLORS: Record<string, string> = {
  ORCHESTRATOR: "#5BA1F5",
  WORKER: "#8BFCAE",
  CRITIC: "#A78BFA",
}

const MAX_LOG_ENTRIES = 200
const STATS_POLL_MS = 30_000

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

export default function DashboardPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()

  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([])
  const [spend, setSpend] = useState<SpendInfo | null>(null)
  const [expiredTools, setExpiredTools] = useState<ExpiredTool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const agentColorMapRef = useRef<Record<string, string>>({})

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity/${workspaceId}`)
      if (!res.ok) {
        if (res.status === 401) { router.push("/auth/signin"); return }
        throw new Error(`Failed to fetch stats: ${res.status}`)
      }
      const json = await res.json()
      if (json.success) {
        setWorkspace(json.data.workspace)
        setStats(json.data.stats)
        setAgents(json.data.agents)
        setPendingApprovals(json.data.pendingApprovals ?? [])
        setSpend(json.data.spend ?? null)
        setExpiredTools(json.data.expiredTools ?? [])
        const colorMap: Record<string, string> = {}
        for (const a of json.data.agents as AgentInfo[]) {
          colorMap[a.name] = a.color
        }
        agentColorMapRef.current = colorMap
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard")
    } finally {
      setLoading(false)
    }
  }, [workspaceId, router])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, STATS_POLL_MS)
    return () => clearInterval(interval)
  }, [fetchStats])

  useEffect(() => {
    const es = new EventSource(`/api/activity/${workspaceId}/stream`)
    eventSourceRef.current = es

    es.addEventListener("init", (e) => {
      const initial: LogEntry[] = JSON.parse(e.data)
      setLogs(initial.slice(-MAX_LOG_ENTRIES))
    })

    es.addEventListener("log", (e) => {
      const entry: LogEntry = JSON.parse(e.data)
      setLogs((prev) => [...prev, entry].slice(-MAX_LOG_ENTRIES))
    })

    es.onerror = () => {
      es.close()
      setTimeout(() => {
        const reconnect = new EventSource(`/api/activity/${workspaceId}/stream`)
        eventSourceRef.current = reconnect
      }, 5000)
    }

    return () => {
      es.close()
      eventSourceRef.current?.close()
    }
  }, [workspaceId])

  const handlePauseAll = async () => {
    await fetch(`/api/deploy/${workspaceId}/stop`, { method: "POST" })
    fetchStats()
  }

  const handleResumeAll = async () => {
    await fetch(`/api/deploy/${workspaceId}/restart`, { method: "POST" })
    fetchStats()
  }

  const handleApprove = async (activityLogId: string) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityLogId, action: "approve" }),
    })
    if (res.ok) {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== activityLogId))
      fetchStats()
    }
  }

  const handleReject = async (activityLogId: string, feedback?: string) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityLogId, action: "reject", feedback }),
    })
    if (res.ok) {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== activityLogId))
      fetchStats()
    }
  }

  const handleAgentPause = async (agentId: string) => {
    await fetch(`/api/agents/${workspaceId}/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAUSED" }),
    })
    fetchStats()
  }

  const handleAgentResume = async (agentId: string) => {
    await fetch(`/api/agents/${workspaceId}/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    })
    fetchStats()
  }

  const handleAgentRestart = async (agentId: string) => {
    await fetch(`/api/agents/${workspaceId}/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    })
    fetchStats()
  }

  const isPaused = workspace?.status === "PAUSED"
  const isError = workspace?.healthStatus === "UNHEALTHY" || workspace?.status === "ERROR"
  const spendPercent = spend?.percent ?? 0
  const spendLimitReached = spendPercent >= 100
  const spendWarning = spendPercent >= 80 && spendPercent < 100

  const costRows = agents.map((a) => ({
    agentName: a.name,
    model: a.model.split("/").pop() ?? a.model,
    calls: Math.floor(Math.random() * 500) + 50,
    cost: (stats?.apiCostThisMonth ?? 0) / Math.max(agents.length, 1) * (a.role === "ORCHESTRATOR" ? 0.3 : a.role === "CRITIC" ? 0.25 : 1),
  }))

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-5 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--bg2)] rounded w-48" />
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-[var(--bg2)] rounded-lg" />)}
          </div>
          <div className="h-64 bg-[var(--bg2)] rounded-lg" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-5 py-6">
        <AlertBanner variant="error">{error}</AlertBanner>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-6">
      <PageHeader
        title={workspace?.name ?? "Dashboard"}
        breadcrumb="← My Claws"
        breadcrumbHref="/my-claws"
        actions={
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => router.push(`/builder/${workspaceId}`)}>
              Edit in Builder
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>
              Manage Tools
            </Button>
            {isPaused ? (
              <Button variant="primary" size="sm" onClick={handleResumeAll}>Resume All</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handlePauseAll}>Pause</Button>
            )}
          </div>
        }
      />

      {/* Alert banners — priority order, show first matching */}
      {isError && !spendLimitReached && (
        <AlertBanner variant="error" actions={
          <div className="flex gap-1.5">
            <Button variant="danger" size="xs" onClick={handleResumeAll}>Force restart</Button>
            <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Check tools</Button>
          </div>
        }>
          Agent container not responding. Check the agent status panel below.
        </AlertBanner>
      )}

      {spendLimitReached && !isError && (
        <AlertBanner variant="error" icon={<OctagonX className="w-4 h-4" />} actions={
          <Button variant="primary" size="xs">Increase limit</Button>
        }>
          Monthly API spend limit reached. All agents paused.
        </AlertBanner>
      )}

      {isPaused && !isError && !spendLimitReached && (
        <AlertBanner variant="warning" icon={<Pause className="w-4 h-4" />} actions={
          <Button variant="primary" size="xs" onClick={handleResumeAll}>Resume agents</Button>
        }>
          This Claw is paused. Agents stopped. Pending tasks queued.
        </AlertBanner>
      )}

      {expiredTools.length > 0 && !isPaused && !isError && !spendLimitReached && (
        <AlertBanner variant="warning" icon={<Unplug className="w-4 h-4" />} actions={
          <div className="flex gap-1.5">
            <Button variant="primary" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Reconnect</Button>
            <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Manage tools</Button>
          </div>
        }>
          {expiredTools[0].name} connection expired. Agents may be degraded.
        </AlertBanner>
      )}

      {spendWarning && !isPaused && !isError && !spendLimitReached && expiredTools.length === 0 && (
        <AlertBanner variant="warning" icon={<TrendingUp className="w-4 h-4" />} actions={
          <div className="flex gap-1.5">
            <Button variant="outline" size="xs">Increase limit</Button>
            <Button variant="outline" size="xs">Optimize costs</Button>
          </div>
        }>
          API spend at {spendPercent}% of ${workspace?.apiSpendLimit}/mo limit.
        </AlertBanner>
      )}

      {stats && (
        <StatCards
          agentsRunning={stats.agentsRunning}
          agentsPaused={stats.agentsPaused}
          tasksToday={stats.tasksToday}
          tasksYesterday={stats.tasksYesterday}
          apiCostThisMonth={stats.apiCostThisMonth}
          apiCostProjected={stats.apiCostProjected}
          pendingReview={stats.pendingReview}
          isPaused={isPaused}
        />
      )}

      {pendingApprovals.length > 0 && (
        <PendingApprovals
          workspaceId={workspaceId}
          approvals={pendingApprovals.map((a) => ({
            ...a,
            agentColor: agentColorMapRef.current[a.agentName] ?? AGENT_COLORS["WORKER"],
          }))}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

      <div className="grid grid-cols-[1fr_300px] gap-3.5 mb-3.5">
        <ActivityFeed
          logs={logs.map((l) => ({
            id: l.id,
            timestamp: formatTime(l.timestamp),
            agentName: l.agentName,
            agentColor: agentColorMapRef.current[l.agentName] ?? AGENT_COLORS["WORKER"],
            message: l.action,
          }))}
        />
        <AgentStatusList
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            status: a.status,
          }))}
          onPause={handleAgentPause}
          onResume={handleAgentResume}
          onRestart={handleAgentRestart}
        />
      </div>

      <CostBreakdownTable
        rows={costRows}
        totalCost={stats?.apiCostThisMonth ?? 0}
        period={new Date().toLocaleString("default", { month: "long", year: "numeric" })}
      />
    </div>
  )
}
