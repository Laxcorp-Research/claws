import { useMemo } from "react"

interface CostRow {
  agentName: string
  model: string
  calls: number
  cost: number
}

interface CostBreakdownTableProps {
  rows: CostRow[]
  totalCost: number
  period: string
  optimizationTip?: string
}

export function CostBreakdownTable({ rows, totalCost, period, optimizationTip }: CostBreakdownTableProps) {
  const sorted = [...rows].sort((a, b) => b.cost - a.cost)

  const computedTip = useMemo(() => {
    if (optimizationTip) return optimizationTip
    if (rows.length === 0 || totalCost === 0) return null

    const topAgent = sorted[0]
    if (!topAgent) return null
    const topPercent = Math.round((topAgent.cost / totalCost) * 100)

    if (topPercent > 40) {
      const model = topAgent.model.toLowerCase()
      if (model.includes("opus")) {
        return `💡 ${topAgent.agentName} accounts for ${topPercent}% of costs. Consider switching from Opus to Sonnet — Sonnet handles most tasks well at ~5× lower cost.`
      }
      if (model.includes("sonnet")) {
        return `💡 ${topAgent.agentName} accounts for ${topPercent}% of costs. Consider switching to Haiku for routine tasks — it's ~15× cheaper than Sonnet.`
      }
      return `💡 ${topAgent.agentName} accounts for ${topPercent}% of costs. Review its task frequency or consider a lighter model.`
    }
    return null
  }, [rows, totalCost, optimizationTip, sorted])

  return (
    <div className="border border-[var(--bd)] rounded-xl p-3.5">
      <div className="flex justify-between items-center mb-2.5">
        <h4 className="text-[13px] font-semibold">API cost breakdown — {period}</h4>
        <span className="text-[16px] font-semibold text-[var(--tx)]">${totalCost.toFixed(2)}</span>
      </div>
      <div className="text-xs">
        <div className="flex justify-between py-1.5 border-b border-[var(--bd)]">
          <span className="font-medium">Agent</span>
          <div className="flex gap-5">
            <span className="w-[50px] text-right font-medium">Model</span>
            <span className="w-[50px] text-right font-medium">Calls</span>
            <span className="w-[60px] text-right font-medium">Cost</span>
          </div>
        </div>
        {sorted.map((row) => (
          <div key={row.agentName} className="flex justify-between py-1.5 border-b border-[var(--bd)] last:border-b-0">
            <span>{row.agentName}</span>
            <div className="flex gap-5">
              <span className="w-[50px] text-right text-[var(--tx2)] text-[10px]">{row.model}</span>
              <span className="w-[50px] text-right">{row.calls.toLocaleString()}</span>
              <span className="w-[60px] text-right font-semibold">${row.cost.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      {computedTip && (
        <div className="text-[11px] bg-[var(--bg2)] rounded-[6px] p-2 mt-2.5 text-[var(--tx2)]">
          {computedTip}
        </div>
      )}
    </div>
  )
}
