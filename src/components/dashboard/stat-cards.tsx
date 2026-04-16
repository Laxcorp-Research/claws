"use client"

import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"
import { formatCurrency, formatCurrencyRounded } from "@/lib/utils/format"

interface StatCardsProps {
  agentsRunning: number
  agentsPaused: number
  tasksToday: number
  tasksYesterday: number
  apiCostThisMonth: number
  apiCostProjected: number
  pendingReview: number
  isPaused?: boolean
  isHibernated?: boolean
  creditMode?: boolean
  creditBalanceCents?: number
  creditDaysEstimate?: string
}

export function StatCards({
  agentsRunning, agentsPaused, tasksToday, tasksYesterday,
  apiCostThisMonth, apiCostProjected, pendingReview, isPaused,
  isHibernated, creditMode, creditBalanceCents, creditDaysEstimate,
}: StatCardsProps) {
  const taskDiff = tasksToday - tasksYesterday
  const month = new Date().toLocaleString("default", { month: "long" })
  const dimmed = isPaused || isHibernated
  const creditLow = creditMode && creditBalanceCents !== undefined && creditBalanceCents > 0 && creditBalanceCents < 500

  return (
    <div className={cn("grid gap-2 mb-3.5", creditMode ? "grid-cols-5" : "grid-cols-4", dimmed && "opacity-50")}>
      <StatCard
        label="Agents running"
        value={isHibernated ? "Hibernating" : isPaused ? "Paused" : agentsRunning}
        trend={agentsPaused > 0 ? `${agentsPaused} paused` : "All healthy"}
        trendType={agentsPaused > 0 ? "down" : "up"}
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
