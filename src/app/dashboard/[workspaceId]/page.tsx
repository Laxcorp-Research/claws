"use client"

import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { OctagonX, Pause, Unplug, TrendingUp, Clock, RefreshCw } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Modal } from "@/components/ui/modal"
import { DeployProgress } from "@/components/setup/deploy-progress"
import { StatCards } from "@/components/dashboard/stat-cards"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { AgentStatusList } from "@/components/dashboard/agent-status-list"
import { CostBreakdownTable } from "@/components/dashboard/cost-breakdown-table"
import { PendingApprovals } from "@/components/dashboard/pending-approvals"
import { VersionUpdateBanner } from "@/components/dashboard/version-update-banner"
import { formatCurrencyRounded, getModelDisplayName } from "@/lib/utils/format"

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
  lastHealthCheck?: string
}

interface AgentInfo {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  model: string
  agentSlug: string
  status: "healthy" | "paused" | "error" | "offline"
  lastActive?: string
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

interface DashboardAlert {
  key: string
  priority: number
  variant: "error" | "warning"
  icon?: ReactNode
  content: ReactNode
  actions?: ReactNode
}

const AGENT_COLORS: Record<string, string> = {
  ORCHESTRATOR: "#5BA1F5",
  WORKER: "#8BFCAE",
  CRITIC: "#A78BFA",
}

const ROLE_ORDER: Record<string, number> = { ORCHESTRATOR: 0, WORKER: 1, CRITIC: 2 }

const MAX_LOG_ENTRIES = 200
const STATS_POLL_MS = 30_000

const REDEPLOY_STAGES = [
  { label: "Generating workspace files", key: "GENERATING" },
  { label: "Provisioning container", key: "PROVISIONING" },
  { label: "Configuring workspace", key: "CONFIGURING" },
  { label: "Starting gateway", key: "STARTING" },
  { label: "Health check", key: "HEALTH_CHECK" },
  { label: "Connecting channels", key: "WAITING_CHANNELS" },
  { label: "Complete", key: "COMPLETED" },
]

const REDEPLOY_ORDER = REDEPLOY_STAGES.map((s) => s.key)

function mapRedeployStatus(status: string | null, failedAtStage?: string | null): { label: string; status: "complete" | "running" | "pending" | "failed" }[] {
  if (!status || status === "PENDING") return REDEPLOY_STAGES.map((s, i) => ({ label: s.label, status: i === 0 ? "running" as const : "pending" as const }))

  if (status === "FAILED") {
    const failIdx = failedAtStage ? REDEPLOY_ORDER.indexOf(failedAtStage) : -1
    return REDEPLOY_STAGES.map((s) => {
      const si = REDEPLOY_ORDER.indexOf(s.key)
      if (failIdx >= 0) {
        if (si < failIdx) return { label: s.label, status: "complete" as const }
        if (si === failIdx) return { label: s.label, status: "failed" as const }
      }
      return { label: s.label, status: "pending" as const }
    })
  }

  const idx = REDEPLOY_ORDER.indexOf(status)
  return REDEPLOY_STAGES.map((s) => {
    const si = REDEPLOY_ORDER.indexOf(s.key)
    if (si < idx) return { label: s.label, status: "complete" as const }
    if (si === idx) return { label: s.label, status: status === "COMPLETED" ? "complete" as const : "running" as const }
    return { label: s.label, status: "pending" as const }
  })
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
}

function relativeTime(isoStr: string | undefined): string {
  if (!isoStr) return "unknown"
  const seconds = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} hour${hours !== 1 ? "s" : ""} ago`
}

interface AgentCostRow {
  agentName: string
  role: string
  model: string
  calls: number
  cost: number
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
  const [trialInfo, setTrialInfo] = useState<{ trialUsed: boolean; trialEndsAt: string | null; hasActiveSubscription: boolean } | null>(null)
  const [agentActionLoadingId, setAgentActionLoadingId] = useState<string | null>(null)
  const [deploymentImage, setDeploymentImage] = useState<string | null>(null)
  const [agentCosts, setAgentCosts] = useState<AgentCostRow[]>([])
  const [subscribing, setSubscribing] = useState(false)
  const [redeployConfirmOpen, setRedeployConfirmOpen] = useState(false)
  const [redeployModalOpen, setRedeployModalOpen] = useState(false)
  const [redeployStatus, setRedeployStatus] = useState<string | null>(null)
  const [redeployLastStage, setRedeployLastStage] = useState<string | null>(null)
  const [redeployError, setRedeployError] = useState<string | null>(null)
  const [redeployBanner, setRedeployBanner] = useState<{ variant: "error" | "info"; message: string } | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const redeployEsRef = useRef<EventSource | null>(null)
  const agentColorMapRef = useRef<Record<string, string>>({})

  const handleSubscribe = useCallback(async () => {
    setSubscribing(true)
    try {
      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "claw_platform", workspaceId, returnUrl: `/checkout/complete` }),
      })
      const json = await res.json()
      if (json.data?.checkoutUrl) {
        window.open(json.data.checkoutUrl, "_blank")
      } else if (json.data?.mockMode) {
        setTrialInfo((prev) => prev ? { ...prev, hasActiveSubscription: true } : prev)
      }
    } catch { /* network error — button re-enables */ }
    setSubscribing(false)
  }, [workspaceId])

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
        if (json.data.agentCosts) {
          setAgentCosts((json.data.agentCosts as { agentName: string; role: string; model: string; calls: number; cost: number }[]).map((c) => ({
            agentName: c.agentName,
            role: c.role,
            model: getModelDisplayName(c.model),
            calls: c.calls,
            cost: c.cost,
          })))
        }
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

  const fetchDeploymentImage = useCallback(() => {
    fetch(`/api/deploy/${workspaceId}/status`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.deployment?.containerImage) {
          setDeploymentImage(json.data.deployment.containerImage)
        }
      })
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    fetchStats()
    fetchDeploymentImage()
    fetch("/api/user/billing")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setTrialInfo({
            trialUsed: json.data.trialUsed,
            trialEndsAt: json.data.trialEndsAt,
            hasActiveSubscription: json.data.hasActiveSubscription,
          })
        }
      })
      .catch(() => {})
    const interval = setInterval(fetchStats, STATS_POLL_MS)
    return () => clearInterval(interval)
  }, [fetchStats, fetchDeploymentImage])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === "dodo-checkout-complete") {
        fetchStats()
        fetch("/api/user/billing").then((r) => r.json()).then((json) => {
          if (json.success) setTrialInfo({ trialUsed: json.data.trialUsed, trialEndsAt: json.data.trialEndsAt, hasActiveSubscription: json.data.hasActiveSubscription })
        }).catch(() => {})
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
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

  const closeRedeployStream = useCallback(() => {
    redeployEsRef.current?.close()
    redeployEsRef.current = null
  }, [])

  const handleRedeploy = useCallback(async () => {
    setRedeployConfirmOpen(false)
    setRedeployModalOpen(true)
    setRedeployStatus("PENDING")
    setRedeployLastStage(null)
    setRedeployError(null)
    setRedeployBanner(null)

    const es = new EventSource(`/api/deploy/${workspaceId}/stream`)
    redeployEsRef.current = es

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data) as { status: string; error?: string }
      if (data.status !== "FAILED" && data.status !== "COMPLETED") {
        setRedeployLastStage(data.status)
      }
      setRedeployStatus(data.status)
      if (data.error) setRedeployError(data.error)
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        es.close()
        redeployEsRef.current = null
      }
    })

    es.onerror = () => {
      es.close()
      redeployEsRef.current = null
    }

    try {
      const res = await fetch(`/api/deploy/${workspaceId}/redeploy`, { method: "POST" })
      const json = await res.json()
      closeRedeployStream()
      if (!res.ok) {
        setRedeployStatus("FAILED")
        setRedeployError(json.error?.message ?? "Redeploy failed")
      } else {
        setRedeployStatus((prev) => prev === "COMPLETED" ? prev : "COMPLETED")
      }
    } catch {
      closeRedeployStream()
      setRedeployStatus("FAILED")
      setRedeployError("Network error — could not reach the server")
    }
  }, [workspaceId, closeRedeployStream])

  const handleRedeployDone = useCallback(() => {
    setRedeployModalOpen(false)
    closeRedeployStream()
    if (redeployStatus === "COMPLETED") {
      setRedeployBanner({ variant: "info", message: "Redeployment successful" })
      fetchStats()
      fetchDeploymentImage()
    }
    setRedeployStatus(null)
    setRedeployLastStage(null)
    setRedeployError(null)
  }, [redeployStatus, closeRedeployStream, fetchStats, fetchDeploymentImage])

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

  const handleAgentControl = async (agentId: string, action: "pause" | "resume" | "restart") => {
    setAgentActionLoadingId(agentId)
    try {
      await fetch(`/api/agents/${workspaceId}/${agentId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      fetchStats()
    } finally {
      setAgentActionLoadingId(null)
    }
  }

  const handleAgentPause = (agentId: string) => handleAgentControl(agentId, "pause")
  const handleAgentResume = (agentId: string) => handleAgentControl(agentId, "resume")
  const handleAgentRestart = (agentId: string) => handleAgentControl(agentId, "restart")

  const isPaused = workspace?.status === "PAUSED"
  const isError = workspace?.healthStatus === "UNHEALTHY" || workspace?.status === "ERROR"
  const showRedeploy = workspace?.status === "RUNNING" || workspace?.status === "ERROR"
  const redeploying = redeployModalOpen && redeployStatus !== "COMPLETED" && redeployStatus !== "FAILED"
  const spendPercent = spend?.percent ?? 0
  const spendLimitReached = spendPercent >= 100
  const spendWarning = spendPercent >= 80 && spendPercent < 100

  const alerts = useMemo(() => {
    const list: DashboardAlert[] = []

    if (isError) {
      list.push({
        key: "container-error",
        priority: 0,
        variant: "error",
        content: (
          <>
            <p className="font-medium">Agent container is not responding</p>
            <p className="mt-0.5 opacity-80">Last healthy: {relativeTime(workspace?.lastHealthCheck)}. Check the agent status panel below.</p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="danger" size="xs" onClick={handleResumeAll}>Force restart</Button>
            <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Check tools</Button>
          </div>
        ),
      })
    }

    if (spendLimitReached) {
      list.push({
        key: "spend-limit",
        priority: 1,
        variant: "error",
        icon: <OctagonX className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">Monthly API spend limit reached ({formatCurrencyRounded(spend?.thisMonth ?? 0)}/{formatCurrencyRounded(spend?.limit ?? 0)})</p>
            <p className="mt-0.5 opacity-80">All agents have been paused to prevent further charges. Resume by increasing your limit or waiting until next month.</p>
          </>
        ),
        actions: <Button variant="primary" size="xs" onClick={() => router.push("/settings?tab=billing")}>Increase limit</Button>,
      })
    }

    if (spendWarning) {
      const dayOfMonth = new Date().getDate()
      const dailyAvg = dayOfMonth > 0 ? (spend?.thisMonth ?? 0) / dayOfMonth : 0
      const remaining = (spend?.limit ?? 0) - (spend?.thisMonth ?? 0)
      const daysRemaining = dailyAvg > 0 ? Math.round(remaining / dailyAvg) : 0
      list.push({
        key: "spend-warning",
        priority: 4,
        variant: "warning",
        icon: <TrendingUp className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">API spend at {spendPercent}% of your ${workspace?.apiSpendLimit}/mo limit</p>
            <p className="mt-0.5 opacity-80">At current usage, you&apos;ll hit the limit in ~{daysRemaining} day{daysRemaining !== 1 ? "s" : ""}.</p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="outline" size="xs" onClick={() => router.push("/settings?tab=billing")}>Increase limit</Button>
            <Button variant="outline" size="xs">Optimize costs</Button>
          </div>
        ),
      })
    }

    if (expiredTools.length > 0) {
      const toolNames = expiredTools.map((t) => t.name).join(", ")
      list.push({
        key: "tools-expired",
        priority: 3,
        variant: "warning",
        icon: <Unplug className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">{expiredTools[0].name} connection expired</p>
            <p className="mt-0.5 opacity-80">
              {expiredTools.length === 1
                ? `Your connection to ${toolNames} has expired. Agents that use it are operating with degraded functionality.`
                : `${expiredTools.length} tool connections have expired (${toolNames}). Agents may be degraded.`}
            </p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="primary" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Reconnect</Button>
            <Button variant="outline" size="xs" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>Manage tools</Button>
          </div>
        ),
      })
    }

    if (trialInfo && trialInfo.trialUsed && !trialInfo.hasActiveSubscription) {
      const trialEnd = trialInfo.trialEndsAt ? new Date(trialInfo.trialEndsAt) : null
      const now = new Date()
      const trialActive = trialEnd && trialEnd > now

      if (trialActive) {
        const msLeft = trialEnd.getTime() - now.getTime()
        const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
        list.push({
          key: "trial-active",
          priority: 2,
          variant: "warning",
          icon: <Clock className="w-4 h-4" />,
          content: (
            <>
              <p className="font-medium">Free trial - {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining</p>
              <p className="mt-0.5 opacity-80">Subscribe to keep your Claws running after the trial ends.</p>
            </>
          ),
          actions: (
            <Button variant="primary" size="xs" loading={subscribing} onClick={handleSubscribe}>
              Subscribe - $79/mo
            </Button>
          ),
        })
      } else {
        list.push({
          key: "trial-expired",
          priority: 1,
          variant: "error",
          icon: <Clock className="w-4 h-4" />,
          content: (
            <>
              <p className="font-medium">Your trial has ended</p>
              <p className="mt-0.5 opacity-80">Subscribe to resume your Claws. Your data and configuration are preserved.</p>
            </>
          ),
          actions: (
            <Button variant="primary" size="xs" loading={subscribing} onClick={handleSubscribe}>
              Subscribe - $79/mo
            </Button>
          ),
        })
      }
    }

    if (isPaused) {
      list.push({
        key: "paused",
        priority: 5,
        variant: "warning",
        icon: <Pause className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">This Claw is paused</p>
            <p className="mt-0.5 opacity-80">Agents have stopped running. Pending tasks are queued and will resume when you unpause.</p>
          </>
        ),
      })
    }

    list.sort((a, b) => a.priority - b.priority)
    return list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, isPaused, spendLimitReached, spendWarning, spendPercent, spend, expiredTools, workspace, workspaceId, router, trialInfo, subscribing, handleSubscribe])

  const costRows = useMemo(() =>
    [...agentCosts].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 1
      const rb = ROLE_ORDER[b.role] ?? 1
      if (ra !== rb) return ra - rb
      return a.agentName.localeCompare(b.agentName)
    }),
    [agentCosts],
  )
  const costTotal = useMemo(() => costRows.reduce((sum, r) => sum + r.cost, 0), [costRows])

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 1
      const rb = ROLE_ORDER[b.role] ?? 1
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    }),
    [agents],
  )

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-5 py-6">
        <div className="h-6 bg-[var(--bg2)] rounded w-48 mb-4" />
        <div className="grid grid-cols-4 gap-2 mb-3.5">
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
        <div className="grid grid-cols-[1fr_300px] gap-3.5 mb-3.5">
          <div className="border border-[var(--bd)] rounded-lg p-3 space-y-2">
            <LoadingSkeleton variant="short" />
            <LoadingSkeleton variant="line" count={5} />
          </div>
          <div className="border border-[var(--bd)] rounded-xl p-3.5 space-y-2">
            <LoadingSkeleton variant="short" />
            <LoadingSkeleton variant="line" count={4} />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-5 py-6">
        <AlertBanner variant="error" actions={<Button variant="outline" size="sm" onClick={fetchStats}>Retry</Button>}>
          {error}
        </AlertBanner>
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
            {showRedeploy && (
              <Button
                variant="outline"
                size="sm"
                loading={redeploying}
                onClick={() => setRedeployConfirmOpen(true)}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {redeploying ? "Redeploying…" : "Redeploy"}
              </Button>
            )}
            {isPaused ? (
              <Button variant="primary" size="sm" onClick={handleResumeAll}>Resume All</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handlePauseAll}>Pause</Button>
            )}
          </div>
        }
      />

      {redeployBanner && (
        <AlertBanner
          variant={redeployBanner.variant}
          actions={
            redeployBanner.variant === "error" ? (
              <Button variant="outline" size="xs" onClick={() => setRedeployConfirmOpen(true)}>Retry</Button>
            ) : undefined
          }
        >
          <p className="font-medium">{redeployBanner.message}</p>
        </AlertBanner>
      )}

      {alerts.length > 0 && (
        <div className="space-y-2 mb-3">
          {alerts.map((alert) => (
            <AlertBanner key={alert.key} variant={alert.variant} icon={alert.icon} actions={alert.actions}>
              {alert.content}
            </AlertBanner>
          ))}
        </div>
      )}

      {deploymentImage && (
        <VersionUpdateBanner
          workspaceId={workspaceId}
          currentImage={deploymentImage}
          onUpdated={() => { fetchStats(); fetchDeploymentImage() }}
        />
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

      <div className="grid grid-cols-[1fr_280px] gap-3">
        <ActivityFeed
          logs={logs.map((l) => ({
            id: l.id,
            timestamp: formatTime(l.timestamp),
            agentName: l.agentName,
            agentColor: agentColorMapRef.current[l.agentName] ?? AGENT_COLORS["WORKER"],
            message: l.action,
          }))}
        />

        <div className="flex flex-col gap-3">
          <AgentStatusList
            agents={sortedAgents.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              status: a.status === "healthy" ? "running" as const : a.status,
              lastActive: a.lastActive ? relativeTime(a.lastActive) : undefined,
            }))}
            clawPaused={isPaused}
            onPauseAgent={handleAgentPause}
            onResumeAgent={handleAgentResume}
            onRestartAgent={handleAgentRestart}
            actionLoadingId={agentActionLoadingId}
          />

          <CostBreakdownTable
            rows={costRows}
            totalCost={costTotal}
            period={new Date().toLocaleString("default", { month: "long", year: "numeric" })}
            workspaceId={workspaceId}
          />
        </div>
      </div>

      <ConfirmDialog
        open={redeployConfirmOpen}
        onClose={() => setRedeployConfirmOpen(false)}
        onConfirm={handleRedeploy}
        title="Redeploy Claw"
        description="This will update your Claw with the latest configuration and redeploy. Continue?"
        confirmLabel="Redeploy"
        variant="warning"
      />

      <Modal
        open={redeployModalOpen}
        onClose={handleRedeployDone}
        title="Redeploying Claw"
        description={
          redeployStatus === "COMPLETED"
            ? "Your Claw has been redeployed with the latest configuration."
            : redeployStatus === "FAILED"
              ? "Redeployment encountered an error."
              : "Updating configuration and redeploying your Claw…"
        }
        size="sm"
        footer={
          (redeployStatus === "COMPLETED" || redeployStatus === "FAILED") ? (
            <>
              {redeployStatus === "FAILED" && (
                <Button variant="outline" onClick={() => { handleRedeployDone(); setRedeployConfirmOpen(true) }}>Retry</Button>
              )}
              <Button variant="primary" onClick={handleRedeployDone}>
                {redeployStatus === "COMPLETED" ? "Done" : "Close"}
              </Button>
            </>
          ) : undefined
        }
      >
        <DeployProgress
          steps={mapRedeployStatus(redeployStatus, redeployLastStage)}
          failureDetail={redeployStatus === "FAILED" ? redeployError ?? "Deployment failed" : undefined}
        />
      </Modal>
    </div>
  )
}
