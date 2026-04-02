"use client"

import { useMemo } from "react"
import Link from "next/link"

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
        <h4 className="text-[13px] font-semibold">API cost breakdown - {period}</h4>
        <span className="text-[16px] font-semibold text-[var(--tx)]">${totalCost.toFixed(2)}</span>
      </div>

      <div>
        <div className="flex justify-between py-[6px] border-b border-[var(--bd)]">
          <span className="text-[12px] font-medium">Agent</span>
          <div className="flex gap-[20px]">
            <span className="w-[50px] text-right text-[12px] font-medium">Model</span>
            <span className="w-[50px] text-right text-[12px] font-medium">Calls</span>
            <span className="w-[60px] text-right text-[12px] font-medium">Cost</span>
          </div>
        </div>

        {sorted.map((row, i) => (
          <div
            key={row.agentName}
            className={`flex justify-between py-[6px] ${i < sorted.length - 1 ? "border-b border-[var(--bd)]" : ""}`}
          >
            <span className="text-[12px]">{row.agentName}</span>
            <div className="flex gap-[20px]">
              <span className="w-[50px] text-right text-[var(--tx2)] text-[10px]">{row.model}</span>
              <span className="w-[50px] text-right text-[12px]">{row.calls.toLocaleString()}</span>
              <span className="w-[60px] text-right text-[12px] font-semibold">${row.cost.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      {computedTip && (
        <div className="mt-[10px] bg-[var(--bg2)] rounded-[6px] p-[8px] text-[11px] text-[var(--tx2)]">
          <span className="font-bold">Cost optimization tip: </span>
          {computedTip.text}
          {workspaceId && (
            <>
              {" "}
              <Link href={`/builder/${workspaceId}`} className="text-[var(--ac)]">
                Change model in Builder →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
