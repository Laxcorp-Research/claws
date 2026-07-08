import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export type StatChipTone = "ok" | "warn" | "err" | "unknown"

const dotClass: Record<StatChipTone, string> = {
  ok: "bg-[var(--ok)]",
  warn: "bg-[var(--warn)]",
  err: "bg-[var(--err)]",
  unknown: "bg-[var(--tx3)]",
}

interface StatChipProps {
  label: string
  value: ReactNode
  dotTone?: StatChipTone
  title?: string
  ariaLabel?: string
}

export function StatChip({ label, value, dotTone, title, ariaLabel }: StatChipProps) {
  return (
    <div
      className="inline-flex min-h-[28px] items-center gap-[6px] rounded-[999px] border border-[var(--bd)] bg-[var(--bg)] px-[9px] py-[5px]"
      title={title}
      aria-label={ariaLabel}
    >
      {dotTone && <span className={cn("h-[7px] w-[7px] flex-none rounded-full", dotClass[dotTone])} aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <TruncatedText className="max-w-[96px] text-[10px] font-medium text-[var(--tx3)]">{label}</TruncatedText>
      </span>
      <span className="flex-none text-[11px] font-semibold text-[var(--tx)]">{value}</span>
    </div>
  )
}
