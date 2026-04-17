"use client"

import { StatCard } from "@/components/ui/stat-card"

interface UsageSummaryProps {
  totalSpentCents: number
  remainingCents: number
  thisMonthCents: number
  loading?: boolean
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function UsageSummary({
  totalSpentCents,
  remainingCents,
  thisMonthCents,
  loading,
}: UsageSummaryProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 mb-[16px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-[var(--bg2)] rounded-lg p-3 h-[62px] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2 mb-[16px]">
      <StatCard label="Total spent" value={formatDollars(totalSpentCents)} />
      <StatCard
        label="Credits remaining"
        value={formatDollars(remainingCents)}
        alert={remainingCents > 0 && remainingCents < 500}
      />
      <StatCard label="Usage this month" value={formatDollars(thisMonthCents)} />
    </div>
  )
}
