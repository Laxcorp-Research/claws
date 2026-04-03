"use client"

import { useMemo } from "react"
import Link from "next/link"
import { formatCurrency } from "@/lib/utils/format"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

interface CostBreakdownRow {
  agentName: string
  model: string
  calls: number
  cost: number
}

interface CostBreakdownTableProps {
  rows: CostBreakdownRow[]
  totalCost: number
  period: string
  workspaceId?: string
  optimizationTip?: string | null
}

function abbreviateMonth(period: string): string {
  const date = new Date(period)
  if (!isNaN(date.getTime())) {
    return date.toLocaleString("en", { month: "short", year: "numeric" })
  }
  const parts = period.split(" ")
  if (parts.length === 2 && parts[0].length > 3) {
    return parts[0].substring(0, 3) + " " + parts[1]
  }
  return period
}

export function CostBreakdownTable({ rows, totalCost, period, workspaceId, optimizationTip }: CostBreakdownTableProps) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.cost - a.cost), [rows])

  const computedTip = useMemo(() => {
    if (optimizationTip) return { text: optimizationTip, agentName: "", percentage: 0, model: "" }
    if (rows.length === 0 || totalCost === 0) return null

    const topAgent = sorted[0]
    if (!topAgent) return null
    const topPercent = Math.round((topAgent.cost / totalCost) * 100)

    if (topPercent > 40) {
      return {
        text: `Your ${topAgent.agentName} (${topAgent.model}) uses ${topPercent}% of your budget. If cost is a concern, try switching it to a cheaper model - but note that output quality may decrease.`,
        agentName: topAgent.agentName,
        percentage: topPercent,
        model: topAgent.model,
      }
    }
    return null
  }, [rows, totalCost, optimizationTip, sorted])

  return (
    <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
      <div className="flex justify-between items-center mb-[10px]">
        <h4 className="text-[13px] font-semibold whitespace-nowrap">API costs — {abbreviateMonth(period)}</h4>
        <span className="text-[16px] font-semibold text-[var(--tx)] whitespace-nowrap ml-[12px]">{formatCurrency(totalCost)}</span>
      </div>

      <table className="w-full text-[12px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "35%" }} />
          <col style={{ width: "25%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--bd)]">
            <th className="text-left font-medium py-[6px] pr-[8px]">Agent</th>
            <th className="text-left font-medium py-[6px] pr-[8px]">Model</th>
            <th className="text-right font-medium py-[6px] pr-[8px]">Calls</th>
            <th className="text-right font-medium py-[6px]">Cost</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.agentName} className={i < sorted.length - 1 ? "border-b border-[var(--bd)]" : ""}>
              <TruncateWithTooltip className="py-[6px] pr-[8px] whitespace-nowrap overflow-hidden" as="td">{row.agentName}</TruncateWithTooltip>
              <TruncateWithTooltip className="py-[6px] pr-[8px] text-[10px] text-[var(--tx2)] whitespace-nowrap overflow-hidden" as="td">{row.model}</TruncateWithTooltip>
              <td className="py-[6px] pr-[8px] text-right whitespace-nowrap">{row.calls.toLocaleString()}</td>
              <td className="py-[6px] text-right font-semibold whitespace-nowrap">{formatCurrency(row.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {computedTip && (
        <div className="mt-[10px] bg-[var(--bg2)] rounded-[6px] p-[8px] text-[11px] text-[var(--tx2)]">
          <span className="font-bold">Cost optimization tip: </span>
          {computedTip.text}
          {workspaceId && (
            <>
              {" "}
              <Link href={`/builder/${workspaceId}`} className="text-[var(--ac)]">
                Change model in Builder
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
