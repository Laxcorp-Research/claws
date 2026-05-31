"use client"

import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import { formatCurrency, formatCurrencyRounded } from "@/lib/utils/format"

interface StatCardsProps {
  agentsRunning: number
  agentsPaused: number
  // PR-4: per-status counts so the "Agents running" subtext tells the truth
  // instead of the hardcoded "All healthy".
  agentsError?: number
  agentsOffline?: number
  agentsDegraded?: number
  tasksToday: number
  tasksYesterday: number
  apiCostThisMonth: number
  apiCostProjected: number
  pendingReview: number
  isPaused?: boolean
  isStopped?: boolean
  isHibernated?: boolean
  creditMode?: boolean
  creditBalanceCents?: number
  creditDaysEstimate?: string
}

// PR-4: derive the "Agents running" subtext truthfully.
//   - Lifecycle labels first (the value cell shows "Paused"/"Stopped"/
//     "Hibernating", so the subtext should match that intent).
//   - Otherwise precedence error > offline > degraded > paused > healthy:
//     the loudest real problem wins the line, and the count reconciles with
//     the agent rows below.
export function agentsSubtext(opts: {
  agentsError: number
  agentsOffline: number
  agentsDegraded: number
  agentsPaused: number
  isPaused?: boolean
  isStopped?: boolean
  isHibernated?: boolean
}): { text: string; type: "up" | "down" | "warn" } {
  if (opts.isHibernated) return { text: "Will wake on schedule", type: "warn" }
  if (opts.isStopped) return { text: "Restart to revive", type: "down" }
  if (opts.isPaused) return { text: "Resume to continue", type: "warn" }
  if (opts.agentsError > 0) return { text: `${opts.agentsError} not responding`, type: "down" }
  if (opts.agentsOffline > 0) return { text: `${opts.agentsOffline} offline`, type: "down" }
  if (opts.agentsDegraded > 0) return { text: `${opts.agentsDegraded} degraded`, type: "warn" }
  if (opts.agentsPaused > 0) return { text: `${opts.agentsPaused} paused`, type: "warn" }
  return { text: "All healthy", type: "up" }
}

export function StatCards({
  agentsRunning, agentsPaused, agentsError = 0, agentsOffline = 0, agentsDegraded = 0,
  tasksToday, tasksYesterday,
  apiCostThisMonth, apiCostProjected, pendingReview, isPaused,
  isStopped, isHibernated, creditMode, creditBalanceCents, creditDaysEstimate,
}: StatCardsProps) {
  const taskDiff = tasksToday - tasksYesterday
  const month = new Date().toLocaleString("default", { month: "long" })
  const dimmed = isPaused || isStopped || isHibernated
  const creditLow = creditMode && creditBalanceCents !== undefined && creditBalanceCents > 0 && creditBalanceCents < 500
  const agentsTrend = agentsSubtext({ agentsError, agentsOffline, agentsDegraded, agentsPaused, isPaused, isStopped, isHibernated })

  return (
    <div className={cn("grid gap-2 mb-3.5", creditMode ? "grid-cols-5" : "grid-cols-4", dimmed && "opacity-50")}>
      <StatCard
        label="Agents running"
        value={isHibernated ? "Hibernating" : isStopped ? "Stopped" : isPaused ? "Paused" : agentsRunning}
        trend={agentsTrend.text}
        trendType={agentsTrend.type}
      />
      <StatCard
        label="Tasks today"
        value={tasksToday}
        trend={taskDiff >= 0 ? `+${taskDiff} vs yesterday` : `${taskDiff} vs yesterday`}
        trendType={taskDiff >= 0 ? "up" : "down"}
      />
      <StatCard
        label={`API cost (${month})`}
        value={formatCurrency(apiCostThisMonth)}
        trend={`On track: ${formatCurrencyRounded(apiCostProjected)}/mo`}
      />
      <StatCard
        label="Pending review"
        value={pendingReview}
        alert={pendingReview > 0}
        trend={pendingReview > 0 ? "Action needed" : "All clear"}
        trendType={pendingReview > 0 ? "down" : "up"}
      />
      {creditMode && creditBalanceCents !== undefined && creditBalanceCents > 0 && (
        <StatCard
          label="Credits remaining"
          value={`$${(creditBalanceCents / 100).toFixed(2)}`}
          trend={creditDaysEstimate || "Estimating usage..."}
          trendType={creditLow ? "down" : undefined}
          alert={creditLow}
        />
      )}
    </div>
  )
}
