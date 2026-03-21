"use client"

import { StatCard } from "@/components/ui/stat-card"
import { cn } from "@/lib/utils"

interface StatCardsProps {
  agentsRunning: number
  agentsPaused: number
  tasksToday: number
  tasksYesterday: number
  apiCostThisMonth: number
  apiCostProjected: number
  pendingReview: number
  isPaused?: boolean
}

export function StatCards({ agentsRunning, agentsPaused, tasksToday, tasksYesterday, apiCostThisMonth, apiCostProjected, pendingReview, isPaused }: StatCardsProps) {
  const taskDiff = tasksToday - tasksYesterday
  const month = new Date().toLocaleString("default", { month: "long" })

  return (
    <div className={cn("grid grid-cols-4 gap-2 mb-3.5", isPaused && "opacity-50")}>
      <StatCard
        label="Agents running"
        value={isPaused ? "Paused" : agentsRunning}
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
        value={`$${apiCostThisMonth.toFixed(2)}`}
        trend={`On track: $${apiCostProjected.toFixed(0)}/mo`}
      />
      <StatCard
        label="Pending review"
        value={pendingReview}
        alert={pendingReview > 0}
        trend={pendingReview > 0 ? "Action needed" : "All clear"}
        trendType={pendingReview > 0 ? "down" : "up"}
      />
    </div>
  )
}
