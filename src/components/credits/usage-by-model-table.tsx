"use client"

import { useMemo } from "react"
import type { CreditUsageDaily } from "@/hooks/use-credit-usage"

interface UsageByModelTableProps {
  daily: CreditUsageDaily[]
  initialGrantCents: number
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export function UsageByModelTable({
  daily,
  initialGrantCents,
}: UsageByModelTableProps) {
  const rows = useMemo(() => {
    const byKey = new Map<
      string,
      {
        provider: string
        model: string
        calls: number
        input: number
        output: number
        costCents: number
      }
    >()

    for (const d of daily) {
      const key = `${d.provider}::${d.model}`
      const prev = byKey.get(key) ?? {
        provider: d.provider,
        model: d.model,
        calls: 0,
        input: 0,
        output: 0,
        costCents: 0,
      }
      byKey.set(key, {
        provider: d.provider,
        model: d.model,
        calls: prev.calls + d.totalCalls,
        input: prev.input + d.totalInputTokens,
        output: prev.output + d.totalOutputTokens,
        costCents: prev.costCents + d.totalCostCents,
      })
    }

    return Array.from(byKey.values()).sort((a, b) => b.costCents - a.costCents)
  }, [daily])

  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-[var(--tx3)] py-[8px]">
        No per-model usage yet.
      </div>
    )
  }

  return (
    <div className="border border-[var(--bd)] rounded-[8px] overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-[var(--bg2)] text-[10px] uppercase tracking-[0.04em] text-[var(--tx2)]">
          <tr>
            <th className="text-left font-medium px-[12px] py-[6px]">Model</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[70px]">Calls</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Input</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Output</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Cost</th>
            <th className="text-right font-medium px-[12px] py-[6px] w-[60px]">% used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct =
              initialGrantCents > 0
                ? (r.costCents / initialGrantCents) * 100
                : 0
            const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)
            return (
              <tr
                key={`${r.provider}::${r.model}`}
                className="border-t border-[var(--bd)]"
              >
                <td className="px-[12px] py-[6px]">
                  <div className="font-medium text-[var(--tx)]">{r.model}</div>
                  <div className="text-[10px] text-[var(--tx3)]">{r.provider}</div>
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {r.calls.toLocaleString()}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {formatTokens(r.input)}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {formatTokens(r.output)}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums">
                  {formatDollars(r.costCents)}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {pctLabel}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
