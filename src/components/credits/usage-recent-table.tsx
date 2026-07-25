"use client"

import type { CreditUsageRecord } from "@/hooks/use-credit-usage"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

interface UsageRecentTableProps {
  records: CreditUsageRecord[]
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

export function UsageRecentTable({ records }: UsageRecentTableProps) {
  if (records.length === 0) {
    return (
      <div className="text-[11px] text-[var(--tx3)] py-[8px]">
        No recent API calls yet.
      </div>
    )
  }

  return (
    <>
      <div className="border border-[var(--bd)] rounded-[8px] overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg2)] text-[10px] uppercase tracking-[0.04em] text-[var(--tx2)]">
            <tr>
              <th className="text-left font-medium px-[12px] py-[6px] w-[110px]">When</th>
              <th className="text-left font-medium px-[12px] py-[6px]">Workspace</th>
              <th className="text-left font-medium px-[12px] py-[6px]">Model</th>
              <th className="text-right font-medium px-[12px] py-[6px] w-[70px]">Input</th>
              <th className="text-right font-medium px-[12px] py-[6px] w-[70px]">Output</th>
              <th className="text-right font-medium px-[12px] py-[6px] w-[80px]">Cost</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t border-[var(--bd)]">
                <td className="px-[12px] py-[6px] text-[var(--tx2)] max-w-[110px]">
                  <TruncatedText className="whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </TruncatedText>
                </td>
                <td className="px-[12px] py-[6px] text-[var(--tx2)] font-mono text-[11px] max-w-[140px]">
                  <TruncatedText>{r.workspaceId}</TruncatedText>
                </td>
                <td className="px-[12px] py-[6px]">
                  <div className="text-[var(--tx)]">{r.model}</div>
                  <div className="text-[10px] text-[var(--tx3)]">{r.provider}</div>
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {formatTokens(r.inputTokens)}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums text-[var(--tx2)]">
                  {formatTokens(r.outputTokens)}
                </td>
                <td className="px-[12px] py-[6px] text-right tabular-nums">
                  {formatDollars(r.costCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--tx3)] mt-[6px]">
        Showing your {records.length} most recent API call
        {records.length === 1 ? "" : "s"}. Older data is aggregated in the daily view above.
      </p>
    </>
  )
}
