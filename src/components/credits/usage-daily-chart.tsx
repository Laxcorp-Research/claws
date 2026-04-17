"use client"

import { useMemo } from "react"
import type { CreditUsageDaily } from "@/hooks/use-credit-usage"

interface UsageDailyChartProps {
  daily: CreditUsageDaily[]
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDay(isoDate: string): string {
  // date comes back as a full ISO datetime or a date-only string; keep only yyyy-mm-dd
  const ymd = isoDate.slice(0, 10)
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return ymd
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function UsageDailyChart({ daily }: UsageDailyChartProps) {
  const rows = useMemo(() => {
    const byDate = new Map<string, { costCents: number; calls: number }>()
    for (const d of daily) {
      const key = d.date.slice(0, 10)
      const prev = byDate.get(key) ?? { costCents: 0, calls: 0 }
      byDate.set(key, {
        costCents: prev.costCents + d.totalCostCents,
        calls: prev.calls + d.totalCalls,
      })
    }
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 30)
  }, [daily])

  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-[var(--tx3)] py-[8px]">
        No daily activity in the last 30 days.
      </div>
    )
  }

  const max = Math.max(1, ...rows.map(([, v]) => v.costCents))

  return (
    <div className="border border-[var(--bd)] rounded-[8px] overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-[var(--bg2)] text-[10px] uppercase tracking-[0.04em] text-[var(--tx2)]">
          <tr>
            <th className="text-left font-medium px-[12px] py-[6px] w-[80px]">Date</th>
            <th className="text-left font-medium px-[12px] py-[6px]">Spend</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Calls</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([date, v]) => {
            const pct = Math.max(2, Math.round((v.costCents / max) * 100))
            return (
              <tr key={date} className="border-t border-[var(--bd)]">
                <td className="px-[12px] py-[6px] text-[var(--tx2)] whitespace-nowrap">
                  {formatDay(date)}
                </td>
                <td className="px-[12px] py-[6px]">
                  <div className="h-[6px] rounded-full bg-[var(--bd)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--ac)] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
                <td className="px-[12px] py-[6px] text-right text-[var(--tx2)] tabular-nums">
                  {v.calls.toLocaleString()}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums">
                  {formatDollars(v.costCents)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
