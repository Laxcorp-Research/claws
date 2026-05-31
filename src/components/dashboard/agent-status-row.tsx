"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface AgentStatusRowProps {
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  // PR-4: "degraded" = alive but partially broken (amber), distinct from
  // "error" (red, unreachable) and "offline" (grey, not running).
  status: "running" | "healthy" | "paused" | "error" | "starting" | "offline" | "degraded"
  lastActive?: string
  errorMessage?: string
  retryIn?: string
  queuedTasks?: number
  passRate?: number
  canPause: boolean
  onPause?: () => void
  onResume?: () => void
  onRestart?: () => void
  isActionLoading?: boolean
}

const statusDotColor: Record<string, string> = {
  running: "bg-[var(--ok)]",
  healthy: "bg-[var(--ok)]",
  paused: "bg-[var(--warn)]",
  error: "bg-[var(--err)]",
  starting: "bg-[var(--tx3)]",
  offline: "bg-[var(--tx3)]",
  degraded: "bg-[var(--warn)]",
}

const rowBg: Record<string, string> = {
  running: "bg-[var(--bg2)]",
  healthy: "bg-[var(--bg2)]",
  paused: "bg-[var(--warnbg)]",
  error: "bg-[var(--errbg)]",
  starting: "bg-[var(--bg2)]",
  offline: "bg-[var(--bg2)]",
  degraded: "bg-[var(--warnbg)]",
}

function isRunning(s: string) {
  return s === "running" || s === "healthy"
}

function buildMetaText(role: string, status: string, lastActive?: string, errorMessage?: string, retryIn?: string, queuedTasks?: number, passRate?: number): string {
  const roleName = role === "ORCHESTRATOR" ? "Orchestrator" : role === "CRITIC" ? "Critic" : "Worker"

  if (status === "error" && errorMessage) {
    const parts = [`${roleName} · Error: ${errorMessage}`]
    if (retryIn) parts.push(retryIn)
    return parts.join(" · ")
  }

  if (status === "paused") {
    const parts = [`${roleName} · Paused by you`]
    if (queuedTasks !== undefined && queuedTasks > 0) parts.push(`${queuedTasks} queued tasks`)
    return parts.join(" · ")
  }

  if (status === "degraded") {
    return `${roleName} · Running an older configuration · Redeploy to update`
  }

  if (role === "CRITIC" && passRate !== undefined) {
    return `${roleName} · Last review: ${lastActive ?? "unknown"} · Pass rate: ${passRate}%`
  }

  return `${roleName} · Last active: ${lastActive ?? "unknown"}`
}

function getMetaColor(status: string): string {
  if (status === "error") return "text-[#991b1b]"
  if (status === "paused" || status === "degraded") return "text-[#92400e]"
  return "text-[var(--tx2)]"
}

export function AgentStatusRow({
  name,
  role,
  status,
  lastActive,
  errorMessage,
  retryIn,
  queuedTasks,
  passRate,
  canPause,
  onPause,
  onResume,
  onRestart,
  isActionLoading,
}: AgentStatusRowProps) {
  const normalizedStatus = isRunning(status) ? "running" : status

  const statusLabel = normalizedStatus === "running" ? "Running"
    : normalizedStatus === "paused" ? "Paused"
    : normalizedStatus === "error" ? "Error"
    : normalizedStatus === "degraded" ? "Degraded"
    : normalizedStatus === "starting" ? "Starting"
    : "Offline"

  const statusColor = normalizedStatus === "running" ? "text-[var(--ok)]"
    : normalizedStatus === "paused" || normalizedStatus === "degraded" ? "text-[var(--warn)]"
    : normalizedStatus === "error" ? "text-[var(--err)]"
    : "text-[var(--tx3)]"

  return (
    <div className={cn("flex items-center justify-between px-[12px] py-[10px] rounded-[6px] gap-[12px]", rowBg[status] ?? rowBg.offline)}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", statusDotColor[status] ?? statusDotColor.offline)} />
        <div className="min-w-0">
          <div className="mb-[2px]">
            <span className={cn("text-[12px] font-semibold", role === "CRITIC" && "text-[#5b21b6]")}>{name}</span>
          </div>
          <div className={cn("text-[10px]", getMetaColor(normalizedStatus))}>
            {buildMetaText(role, normalizedStatus, lastActive, errorMessage, retryIn, queuedTasks, passRate)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className={cn("text-[10px] font-medium whitespace-nowrap", statusColor)}>{statusLabel}</span>

        {canPause && isRunning(status) && onPause && (
          <Button
            variant="outline"
            className="text-[9px] px-[6px] py-[2px] h-auto"
            onClick={onPause}
            disabled={isActionLoading}
            loading={isActionLoading}
          >
            Pause
          </Button>
        )}

        {canPause && status === "paused" && onResume && (
          <Button
            variant="primary"
            className="text-[9px] px-[6px] py-[2px] h-auto"
            onClick={onResume}
            disabled={isActionLoading}
            loading={isActionLoading}
          >
            Resume
          </Button>
        )}

        {status === "error" && onRestart && (
          <Button
            variant="outline"
            className="text-[9px] px-[6px] py-[2px] h-auto"
            onClick={onRestart}
            disabled={isActionLoading}
            loading={isActionLoading}
          >
            Restart
          </Button>
        )}
      </div>
    </div>
  )
}
