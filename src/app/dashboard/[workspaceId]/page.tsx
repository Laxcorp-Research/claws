"use client"

import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { PageHeader } from "@/components/shared/page-header"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Button } from "@/components/ui/button"
import { OctagonX, Pause, Square, Unplug, TrendingUp, Clock, RefreshCw, Gift, Moon } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { StatusBadge } from "@/components/ui/status-badge"
import { BriefingHeader, clawGreeting } from "@/components/dashboard/briefing-header"
import { NeedsYouSection } from "@/components/dashboard/needs-you-section"
import { ClawNarrativeRow } from "@/components/dashboard/claw-narrative-row"
import { BriefingFooter } from "@/components/dashboard/briefing-footer"
import { VersionUpdateBanner } from "@/components/dashboard/version-update-banner"
import { ChatPanel, type ChatRow } from "@/components/dashboard/chat-panel"
import { ConversationsSection } from "@/components/dashboard/conversations-section"
import { RedeployProgressModal } from "@/components/dashboard/redeploy-progress-modal"
import { useWorkspaceRedeploy } from "@/components/dashboard/use-workspace-redeploy"
import { formatCurrencyRounded, getModelDisplayName } from "@/lib/utils/format"
import { useCreditBalance } from "@/hooks/use-credit-balance"
import { useActivityStream } from "@/hooks/use-activity-stream"
import { isCreditUser } from "@/lib/credits/api-key-source"
import type { ApiKeySource } from "@/generated/prisma/client"
import type { ChannelId, ChannelLiveState, ChannelStatusMap } from "@/lib/openclaw/channel-config"

interface DashboardStats {
  agentsRunning: number
  agentsPaused: number
  // PR-4: per-status breakdown for the truthful "Agents running" subtext.
  agentsError: number
  agentsOffline: number
  agentsDegraded: number
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
  lastHealthCheck?: string | null
  // PR-4: health monitor's last probe classification — drives the 3-state banner.
  lastHealthReason?: string | null
  mcpSessionHealthStatus?: "HEALTHY" | "DEAD" | "UNREACHABLE" | null
  mcpSessionCheckedAt?: string | null
  mcpSessionLastError?: string | null
  activitySilenceDetectedAt?: string | null
  stateSyncStaleDetectedAt?: string | null
  apiKeySource?: ApiKeySource
}

interface AgentInfo {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  model: string
  agentSlug: string
  status: "healthy" | "paused" | "error" | "offline" | "degraded"
  lastActive?: string
}

interface LogEntry {
  id: string
  timestamp: string
  agentName: string
  agentSlug?: string
  action: string
  // PR-4: full expand-on-click context behind the short action. null/absent
  // when the row has no extra detail.
  detail?: string | null
  actionType: string
  apiCost?: number
  // PR-9/B: chat fields projected from metadata by the SSE serializer
  // (formatLog). messageId is the optimistic-reconciliation key; channelId
  // gates the chat panel to webchat rows; runId is the working-indicator
  // turn-correlation key (MESSAGE_SENT.runId pairs a reply to its send).
  // Optional for back-compat with any pre-9/B payload.
  messageId?: string | null
  channelId?: string | null
  from?: string | null
  runId?: string | null
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
  /**
   * PR #4 Commit 6: server returns the raw DB status so the banner can
   * differentiate "OAuth token has expired" (EXPIRED/REVOKED) from a
   * generic "connection failed" (ERROR). Optional for forward/back
   * compat with older API payloads that only carried `name`.
   */
  status?: "ERROR" | "EXPIRED" | "REVOKED"
  connectionType?: "API_KEY" | "OAUTH_COMPOSIO" | "CHANNEL_NATIVE"
}

interface DashboardAlert {
  key: string
  priority: number
  variant: "error" | "warning" | "info"
  icon?: ReactNode
  content: ReactNode
  actions?: ReactNode
}

interface ConfigDriftInfo {
  isStale: boolean
  changedAreas: string[]
}

interface ChannelStatusSummary {
  channels: ChannelStatusMap
  configuredChannelIds: ChannelId[]
  hasConfiguredChannels: boolean
}

const AGENT_COLORS: Record<string, string> = {
  ORCHESTRATOR: "#5BA1F5",
  WORKER: "#8BFCAE",
  CRITIC: "#A78BFA",
}

const ROLE_ORDER: Record<string, number> = { ORCHESTRATOR: 0, WORKER: 1, CRITIC: 2 }

const MAX_LOG_ENTRIES = 200
const STATS_POLL_MS = 30_000

const CHANNEL_LABELS: Record<ChannelId, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  msteams: "Microsoft Teams",
}

function channelStatusBadge(live: ChannelLiveState): "running" | "deploying" | "error" | "setup" {
  if (live === "connected") return "running"
  if (live === "connecting") return "deploying"
  if (live === "error") return "error"
  return "setup"
}

export function ChannelStatusSection({ channelStatus }: { channelStatus: ChannelStatusSummary | null }) {
  const configuredChannelIds = channelStatus?.configuredChannelIds ?? []
  if (configuredChannelIds.length === 0 || !channelStatus) return null

  return (
    <div className="mb-3 rounded-xl border border-[var(--bd)] bg-[var(--bg)] p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[12px] font-semibold text-[var(--tx)]">Channel status</p>
        <p className="text-[10px] text-[var(--tx3)]">Verified from gateway when reachable</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {configuredChannelIds.map((channelId) => {
          const state = channelStatus.channels[channelId]
          return (
            <div key={channelId} className="flex items-center gap-1.5 rounded-lg border border-[var(--bd)] px-2 py-1.5">
              <span className="text-[11px] font-medium text-[var(--tx)]">{CHANNEL_LABELS[channelId]}</span>
              <StatusBadge status={channelStatusBadge(state.live)} />
              {state.detail && <span className="text-[10px] text-[var(--err)]">{state.detail}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatChangedAreas(areas: string[]): string {
  if (areas.length === 0) return "workspace configuration"
  const labels: Record<string, string> = {
    tools: "tools",
    agents: "agents",
    connections: "agent connections",
    channels: "channels",
    keys: "API keys",
    workspace: "workspace settings",
  }
  return areas.map((area) => labels[area] ?? area).join(", ")
}

function formatTime(isoStr: string) {
  // PR-4d: render in UTC with an explicit " UTC" suffix. The activity log is a
  // log surface that gets cross-correlated with Railway logs, OpenClawVersion
  // records, GitHub Actions runs — all of which are UTC. Showing local time
  // without a tz label here forced operators to do mental tz math; the user
  // hit this when staging WIRE-TEST events at 14:10 UTC were rendering as
  // 18:10 (Dubai local) with no indication of which tz was shown.
  const d = new Date(isoStr)
  const hms = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })
  return `${hms} UTC`
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
  const searchParams = useSearchParams()
  const { data: session } = useSession()

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
  const [redeployFromStoppedConfirmOpen, setRedeployFromStoppedConfirmOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [redeployBanner, setRedeployBanner] = useState<{ variant: "error" | "info"; message: string } | null>(null)
  const [configDrift, setConfigDrift] = useState<ConfigDriftInfo | null>(null)
  const [channelStatus, setChannelStatus] = useState<ChannelStatusSummary | null>(null)

  const agentColorMapRef = useRef<Record<string, string>>({})

  const credit = useCreditBalance(30_000)
  const creditMode = credit.hasCredits && (credit.status === "ACTIVE" || credit.status === "EXHAUSTED")

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
        if (res.status === 403 || res.status === 404) { router.replace("/my-claws"); return }
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

  const fetchDeploymentStatus = useCallback(() => {
    fetch(`/api/deploy/${workspaceId}/status?drift=1`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data?.deployment?.containerImage) {
          setDeploymentImage(json.data.deployment.containerImage)
        }
        if (json.success && json.data?.drift) {
          setConfigDrift({
            isStale: Boolean(json.data.drift.isStale),
            changedAreas: Array.isArray(json.data.drift.changedAreas) ? json.data.drift.changedAreas : [],
          })
        }
      })
      .catch(() => {})
  }, [workspaceId])

  const fetchChannelStatus = useCallback(() => {
    fetch(`/api/channels/${workspaceId}/status`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setChannelStatus(json.data as ChannelStatusSummary)
      })
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    fetchStats()
    fetchDeploymentStatus()
    fetchChannelStatus()
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
    const interval = setInterval(() => {
      fetchStats()
      fetchChannelStatus()
    }, STATS_POLL_MS)
    return () => clearInterval(interval)
  }, [fetchStats, fetchDeploymentStatus, fetchChannelStatus])

  useEffect(() => {
    if (searchParams.get("redeployed") !== "changes-applied") return
    setRedeployBanner({ variant: "info", message: "Redeployment successful — changes applied" })
    router.replace(`/dashboard/${workspaceId}`)
  }, [searchParams, router, workspaceId])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === "dodo-checkout-complete") {
        fetchStats()
        fetchChannelStatus()
        fetch("/api/user/billing").then((r) => r.json()).then((json) => {
          if (json.success) setTrialInfo({ trialUsed: json.data.trialUsed, trialEndsAt: json.data.trialEndsAt, hasActiveSubscription: json.data.hasActiveSubscription })
        }).catch(() => {})
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [fetchStats, fetchChannelStatus])

  // PR-9/pre: connection + listener lifecycle lives in useActivityStream —
  // the old inline effect's reconnect path created a bare EventSource with
  // no listeners attached (see the hook's header comment).
  useActivityStream<LogEntry>(workspaceId, {
    onInit: (initial) => setLogs(initial.slice(-MAX_LOG_ENTRIES)),
    onLog: (entry) => setLogs((prev) => [...prev, entry].slice(-MAX_LOG_ENTRIES)),
  })

  useEffect(() => {
    if (workspace?.status === "WAKING" || workspace?.status === "HIBERNATED") {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/workspaces/${workspaceId}`)
          const data = await res.json()
          if (data.success && data.data?.status === "RUNNING") {
            clearInterval(interval)
            router.refresh()
            fetchStats()
            fetchChannelStatus()
          }
        } catch { /* ignore */ }
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [workspace?.status, workspaceId, router, fetchStats, fetchChannelStatus])

  const handleWakeNow = useCallback(async () => {
    await fetch(`/api/dashboard/${workspaceId}/wake`, { method: "POST" })
    setWorkspace((prev) => prev ? { ...prev, status: "WAKING" } : prev)
  }, [workspaceId])

  const handleStopConfirmed = async () => {
    setStopping(true)
    try {
      await fetch(`/api/deploy/${workspaceId}/stop`, { method: "POST" })
      fetchStats()
    } finally {
      setStopping(false)
      setStopConfirmOpen(false)
    }
  }

  const handleResumeAll = useCallback(async () => {
    // STOPPED workspaces have no container — /restart would 400. Route them
    // through the confirm dialog below, which hits /cloud (full redeploy, ~2m).
    if (workspace?.status === "STOPPED") {
      setRedeployFromStoppedConfirmOpen(true)
      return
    }
    await fetch(`/api/deploy/${workspaceId}/restart`, { method: "POST" })
    fetchStats()
    fetchChannelStatus()
  }, [workspace?.status, workspaceId, fetchStats, fetchChannelStatus])

  const handleRedeployFromStopped = async () => {
    setRedeployFromStoppedConfirmOpen(false)
    await fetch(`/api/deploy/${workspaceId}/cloud`, { method: "POST" })
    fetchStats()
    fetchChannelStatus()
  }

  const redeployFlow = useWorkspaceRedeploy({
    workspaceId,
    onCompleted: () => {
      setRedeployBanner({ variant: "info", message: "Redeployment successful" })
      fetchStats()
      fetchDeploymentStatus()
      fetchChannelStatus()
    },
  })

  const handleRedeploy = useCallback(() => {
    setRedeployConfirmOpen(false)
    setRedeployBanner(null)
    void redeployFlow.startRedeploy()
  }, [redeployFlow])

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
  const isStopped = workspace?.status === "STOPPED"
  const isError = workspace?.healthStatus === "UNHEALTHY" || workspace?.status === "ERROR"
  const showRedeploy = workspace?.status === "RUNNING" || workspace?.status === "ERROR"
  const showConfigDrift = configDrift?.isStale === true && (workspace?.status === "RUNNING" || workspace?.status === "PAUSED")
  const showMcpSessionDead =
    workspace?.mcpSessionHealthStatus === "DEAD" &&
    (workspace.status === "RUNNING" || workspace.status === "PAUSED")
  const showActivitySilence =
    workspace?.status === "RUNNING" &&
    Boolean(workspace.activitySilenceDetectedAt)
  const showStateSyncStale =
    workspace?.status === "RUNNING" &&
    Boolean(workspace.stateSyncStaleDetectedAt)
  const redeploying = redeployFlow.redeploying
  const spendPercent = spend?.percent ?? 0
  const spendLimitReached = spendPercent >= 100
  const spendWarning = spendPercent >= 80 && spendPercent < 100

  const alerts = useMemo(() => {
    const list: DashboardAlert[] = []

    // PR-4: 3-state health banner. The pre-PR-4 single banner said "not
    // responding" for every unhealthy state — false for a container that's
    // alive but running a stale config (the health monitor now classifies
    // those as DEGRADED via lastHealthReason, never UNHEALTHY/ERROR).
    if (isError) {
      // status=ERROR or healthStatus=UNHEALTHY → genuinely unreachable
      // (5xx/timeout/network repeated past the debounce threshold).
      list.push({
        key: "container-error",
        priority: 0,
        variant: "error",
        content: (
          <>
            <p className="font-medium">Agent container is not responding</p>
            <p className="mt-0.5 opacity-80">Last healthy: {relativeTime(workspace?.lastHealthCheck ?? undefined)}. Try redeploying to restore the container.</p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="danger" size="xs" onClick={handleResumeAll}>Force restart</Button>
            <Button variant="outline" size="xs" onClick={() => setRedeployConfirmOpen(true)}>Redeploy</Button>
          </div>
        ),
      })
    } else if (workspace?.status === "RUNNING" && workspace?.healthStatus === "DEGRADED") {
      // Alive (the gateway answered) but partially broken. Split by reason:
      // config drift (4xx: stale token / plugin not in this image) → redeploy
      // fixes it; everything else (plugin errors / zero agents at the gateway)
      // → point the operator at the activity log.
      const isConfigDrift =
        workspace.lastHealthReason === "bad-token" ||
        workspace.lastHealthReason === "plugin-not-loaded"
      list.push({
        key: "container-degraded",
        priority: 0,
        variant: "warning",
        content: isConfigDrift ? (
          <>
            <p className="font-medium">Agent is running an older configuration</p>
            <p className="mt-0.5 opacity-80">Redeploy to update it to the latest runtime.</p>
          </>
        ) : (
          <>
            <p className="font-medium">Agent is running but reports issues</p>
            <p className="mt-0.5 opacity-80">Check the activity log for details.</p>
          </>
        ),
        actions: isConfigDrift ? (
          <Button variant="outline" size="xs" onClick={() => setRedeployConfirmOpen(true)}>Redeploy</Button>
        ) : undefined,
      })
    }

    if (showConfigDrift && configDrift) {
      list.push({
        key: "config-drift",
        priority: 2,
        variant: "warning",
        content: (
          <>
            <p className="font-medium">Configuration changed since last deploy — redeploy to apply</p>
            <p className="mt-0.5 opacity-80">Changed: {formatChangedAreas(configDrift.changedAreas)}</p>
          </>
        ),
        actions: (
          <Button variant="outline" size="xs" onClick={() => setRedeployConfirmOpen(true)}>
            Redeploy
          </Button>
        ),
      })
    }

    if (showMcpSessionDead) {
      list.push({
        key: "mcp-session-dead",
        priority: 3,
        variant: "warning",
        icon: <RefreshCw className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">Long-tail tools disconnected — redeploy to restore</p>
            <p className="mt-0.5 opacity-80">
              The Tool Router session for long-tail tools is no longer available. Redeploy to bind a fresh session.
            </p>
          </>
        ),
        actions: (
          <Button variant="outline" size="xs" onClick={() => setRedeployConfirmOpen(true)}>
            Redeploy
          </Button>
        ),
      })
    }

    if (showActivitySilence) {
      list.push({
        key: "activity-silence",
        priority: 3,
        variant: "warning",
        content: (
          <>
            <p className="font-medium">Activity feed appears silent — agents may be running but not reporting.</p>
            <p className="mt-0.5 opacity-80">Restart to restore activity reporting.</p>
          </>
        ),
        actions: (
          <Button variant="danger" size="xs" onClick={handleResumeAll}>
            Force restart
          </Button>
        ),
      })
    }

    if (showStateSyncStale) {
      list.push({
        key: "state-sync-stale",
        priority: 3,
        variant: "warning",
        content: (
          <p className="font-medium">Agent memory backup is stale — recent memory may not survive a restart. Force-restart to restore syncing.</p>
        ),
        actions: (
          <Button variant="danger" size="xs" onClick={handleResumeAll}>
            Force restart
          </Button>
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
      // PR #4 Commit 6: pick the cause-sentence wording based on whether
      // the affected connections are OAuth-backed. When every expired
      // connection is OAUTH_COMPOSIO the D5 copy applies verbatim ("Your
      // OAuth token has expired"); otherwise fall back to the generic
      // "connection stopped working" wording. Mixed cases pick the
      // generic prose — telling an API_KEY user their OAuth token
      // expired is worse than saying nothing specific.
      const allOauth = expiredTools.every((t) => t.connectionType === "OAUTH_COMPOSIO")
      const primary = expiredTools[0]
      const causeSentence = allOauth
        ? "Your OAuth token has expired."
        : "Your connection stopped working."
      const impactSentence = expiredTools.length === 1
        ? `Agents that use ${primary.name} are operating with degraded functionality.`
        : `${expiredTools.length} tool connections have expired (${toolNames}). Agents that use them are operating with degraded functionality.`
      // PR #4 Commit 6: route includes ?mode=manage so the setup-step-2
      // page renders "Manage Tools" chrome instead of "Connect your tools"
      // wizard chrome. Fixes a pre-existing copy mismatch where clicking
      // Reconnect/Manage from the dashboard (post-setup) landed on the
      // initial-setup header.
      const manageHref = `/setup/${workspaceId}/step/2?mode=manage`
      list.push({
        key: "tools-expired",
        priority: 3,
        variant: "warning",
        icon: <Unplug className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">{primary.name} connection expired</p>
            <p className="mt-0.5 opacity-80">
              {causeSentence} {impactSentence}
            </p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="primary" size="xs" onClick={() => router.push(manageHref)}>Reconnect</Button>
            <Button variant="outline" size="xs" onClick={() => router.push(manageHref)}>Manage tools</Button>
          </div>
        ),
      })
    }

    const creditUser = isCreditUser(workspace?.apiKeySource)

    if (!creditUser && trialInfo && trialInfo.trialUsed && !trialInfo.hasActiveSubscription) {
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

    // dead/reserved: read-side scaffolding for a future reversible pause (PR #52, 4fdf0a8); no writer today — do not remove
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

    if (isStopped) {
      list.push({
        key: "stopped",
        priority: 5,
        variant: "warning",
        icon: <OctagonX className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">This Claw is stopped</p>
            <p className="mt-0.5 opacity-80">Your agents, setup, and history are saved &mdash; only the running container stopped. Click Redeploy to bring it back (~2 minutes).</p>
          </>
        ),
        actions: <Button variant="primary" size="xs" onClick={handleResumeAll}>Redeploy</Button>,
      })
    }

    if (workspace?.status === "HIBERNATED") {
      list.push({
        key: "hibernated",
        priority: 5,
        variant: "info",
        icon: <Moon className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">This Claw is hibernating</p>
            <p className="mt-0.5 opacity-80">Agents are sleeping to save resources. They&apos;ll wake automatically for the next scheduled heartbeat, or you can wake them now.</p>
          </>
        ),
        actions: <Button variant="primary" size="xs" onClick={handleWakeNow}>Wake now</Button>,
      })
    }

    if (workspace?.status === "WAKING") {
      list.push({
        key: "waking",
        priority: 5,
        variant: "info",
        content: (
          <>
            <p className="font-medium">Your Claw is waking up</p>
            <p className="mt-0.5 opacity-80">Restarting agents — this usually takes 15-30 seconds.</p>
          </>
        ),
      })
    }

    if (creditMode && credit.status === "EXHAUSTED") {
      list.push({
        key: "credits-exhausted",
        priority: 0,
        variant: "error",
        icon: <Gift className="w-4 h-4" />,
        content: (
          <>
            <p className="font-medium">Claws Starter Credits exhausted</p>
            <p className="mt-0.5 opacity-80">Your agents are paused. Add your API key and subscribe to resume.</p>
          </>
        ),
        actions: (
          <div className="flex gap-1.5">
            <Button variant="primary" size="xs" onClick={() => router.push("/settings?tab=api-keys")}>Add API key</Button>
            <Button variant="outline" size="xs" onClick={() => router.push("/settings?tab=billing")}>Subscribe</Button>
          </div>
        ),
      })
    }

    list.sort((a, b) => a.priority - b.priority)
    return list
  }, [isError, isPaused, isStopped, spendLimitReached, spendWarning, spendPercent, spend, expiredTools, workspace, workspaceId, router, trialInfo, subscribing, handleSubscribe, creditMode, credit.status, handleWakeNow, showConfigDrift, configDrift, showMcpSessionDead, showActivitySilence, showStateSyncStale, handleResumeAll])

  const costRows = useMemo(() =>
    [...agentCosts].sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 1
      const rb = ROLE_ORDER[b.role] ?? 1
      if (ra !== rb) return ra - rb
      return a.agentName.localeCompare(b.agentName)
    }),
    [agentCosts],
  )
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
    // PR-6: calm placeholder matching the briefing layout — a serif-height
    // greeting line, a health-pill stub, then 3 narrative-row placeholders.
    // Uses a gentle animate-pulse (no shimmer sweep) per the briefing aesthetic.
    return (
      <div className="max-w-5xl mx-auto px-5 py-6" role="status" aria-label="Loading briefing">
        <span className="sr-only">Loading…</span>
        <div className="h-8 w-64 rounded-md bg-[var(--bg2)] animate-pulse mb-2.5" />
        <div className="h-5 w-24 rounded-full bg-[var(--bg2)] animate-pulse mb-8" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-[var(--bd)] rounded-lg p-3.5">
              <div className="h-3 w-20 rounded bg-[var(--bg2)] animate-pulse mb-2" />
              <div className="h-4 w-3/4 rounded bg-[var(--bg2)] animate-pulse" />
            </div>
          ))}
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

  // PR-6: greeting name comes from the session (not the activity payload),
  // with a graceful fallback chain name → email local-part → "there".
  const greetingName = session?.user?.name ?? (session?.user?.email ? session.user.email.split("@")[0] : null)

  // Empty/not-yet-working state: workspace exists but there's nothing to brief
  // on (never deployed, mid-setup, stopped, or no agents). Renders the calm
  // empty path instead of the populated briefing.
  const isEmpty =
    !workspace ||
    workspace.status === "DRAFT" ||
    workspace.status === "SETUP_INCOMPLETE" ||
    workspace.status === "STOPPED" ||
    agents.length === 0

  const briefingLogs = logs.map((l) => ({
    id: l.id,
    timestamp: formatTime(l.timestamp),
    agentName: l.agentName,
    agentColor: agentColorMapRef.current[l.agentName] ?? AGENT_COLORS["WORKER"],
    message: l.action,
    detail: l.detail ?? null,
    channelId: l.channelId ?? null,
  }))

  const rosterAgents = sortedAgents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    lastActive: a.lastActive ? relativeTime(a.lastActive) : undefined,
    color: a.color,
  }))

  // PR-9/B: the dashboard chat reuses the SAME activity stream (no second
  // EventSource). Filter the live logs to webchat MESSAGE_* rows — channelId
  // keeps external-channel sends/receives (Slack, etc.) out of dashboard chat.
  const orchestratorName = agents.find((a) => a.role === "ORCHESTRATOR")?.name ?? "Orchestrator"
  const chatRows: ChatRow[] = logs
    .filter(
      (l) =>
        (l.actionType === "MESSAGE_RECEIVED" || l.actionType === "MESSAGE_SENT") &&
        l.channelId === "webchat",
    )
    .map((l) => ({
      id: l.id,
      actionType: l.actionType,
      timestamp: l.timestamp,
      agentName: l.agentName,
      action: l.action,
      detail: l.detail ?? null,
      messageId: l.messageId ?? null,
      runId: l.runId ?? null,
    }))
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
            <Button variant="outline" size="sm" onClick={() => router.push(`/setup/${workspaceId}/step/2?mode=manage`)}>
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
            {isStopped ? (
              <Button variant="primary" size="sm" onClick={handleResumeAll}>Redeploy</Button>
            ) : isPaused ? (
              // dead/reserved: read-side scaffolding for a future reversible pause (PR #52, 4fdf0a8); no writer today — do not remove
              <Button variant="primary" size="sm" onClick={handleResumeAll}>Resume All</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setStopConfirmOpen(true)}>
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
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

      <ChannelStatusSection channelStatus={channelStatus} />

      {deploymentImage && (
        <VersionUpdateBanner
          currentImage={deploymentImage}
          onRedeploy={() => setRedeployConfirmOpen(true)}
          showRedeployAction={!showConfigDrift}
        />
      )}

      {isEmpty ? (
        <div className="py-8">
          <h1 className="font-serif font-normal text-[28px] leading-tight text-[var(--tx)] mb-3">
            {clawGreeting(greetingName)}
          </h1>
          <p className="text-[14px] text-[var(--tx)]">
            {workspace?.name ?? "This Claw"} is ready, but hasn&apos;t started working yet.
          </p>
          <p className="text-[12px] text-[var(--tx3)] mt-1">
            Once it&apos;s running, your briefing shows up here each day.
          </p>
          <div className="mt-5 flex gap-1.5">
            {(workspace?.status === "DRAFT" || workspace?.status === "SETUP_INCOMPLETE") && (
              <Button variant="primary" size="sm" onClick={() => router.push(`/setup/${workspaceId}/step/1`)}>
                Finish setup
              </Button>
            )}
            {workspace?.status === "STOPPED" && (
              <Button variant="primary" size="sm" onClick={() => setRedeployFromStoppedConfirmOpen(true)}>
                Redeploy
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <BriefingHeader
            name={greetingName}
            status={workspace!.status}
            healthStatus={workspace!.healthStatus}
            lastHealthReason={workspace?.lastHealthReason}
          />

          <NeedsYouSection
            approvals={pendingApprovals.map((a) => ({
              ...a,
              agentColor: agentColorMapRef.current[a.agentName] ?? AGENT_COLORS["WORKER"],
            }))}
            onApprove={handleApprove}
            onReject={handleReject}
          />

          {/* PR-9/B: chat is a PRIMARY surface — a sibling section above the
              collapsible drill-down, below time-sensitive approvals. */}
          <ChatPanel
            workspaceId={workspaceId}
            status={workspace!.status}
            rows={chatRows}
            orchestratorName={orchestratorName}
            onWake={handleWakeNow}
            historyEnabled
          />

          <ConversationsSection workspaceId={workspaceId} status={workspace!.status} />

          <ClawNarrativeRow
            clawName={workspace!.name}
            status={workspace!.status}
            tasksToday={stats?.tasksToday ?? 0}
            tasksYesterday={stats?.tasksYesterday ?? 0}
            agentsError={stats?.agentsError ?? 0}
            pendingReview={stats?.pendingReview ?? 0}
            agents={rosterAgents}
            logs={briefingLogs}
            agentCosts={costRows}
            showCosts={isCreditUser(workspace?.apiKeySource)}
            clawPaused={isPaused || isStopped}
            onPauseAgent={handleAgentPause}
            onResumeAgent={handleAgentResume}
            onRestartAgent={handleAgentRestart}
            actionLoadingId={agentActionLoadingId}
          />

          <BriefingFooter
            apiKeySource={workspace!.apiKeySource}
            consumedCents={credit.totalConsumedCents}
            creditStatus={credit.status}
          />
        </>
      )}

      <ConfirmDialog
        open={redeployConfirmOpen}
        onClose={() => setRedeployConfirmOpen(false)}
        onConfirm={handleRedeploy}
        title="Redeploy Claw"
        description="This will update your Claw with the latest configuration and redeploy. Continue?"
        warningText={showStateSyncStale ? "Memory backup is stale — recent agent memory may be lost." : undefined}
        confirmLabel="Redeploy"
        variant="warning"
      />

      <ConfirmDialog
        open={redeployFromStoppedConfirmOpen}
        onClose={() => setRedeployFromStoppedConfirmOpen(false)}
        onConfirm={handleRedeployFromStopped}
        title="Redeploy this Claw?"
        description="The container was stopped and destroyed. Redeploying recreates it from scratch — this usually takes ~2 minutes. Continue?"
        confirmLabel="Redeploy"
        variant="warning"
      />

      <ConfirmDialog
        open={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        onConfirm={handleStopConfirmed}
        title="Stop this Claw?"
        description="Agents will stop running. Your configuration and history are saved — redeploying takes about 2 minutes."
        confirmLabel="Stop"
        cancelLabel="Keep running"
        loading={stopping}
      />

      <RedeployProgressModal
        open={redeployFlow.modalOpen}
        redeploying={redeployFlow.redeploying}
        status={redeployFlow.status}
        lastStage={redeployFlow.lastStage}
        error={redeployFlow.error}
        onClose={redeployFlow.closeModal}
        onRetry={redeployFlow.retry}
      />
    </div>
  )
}
