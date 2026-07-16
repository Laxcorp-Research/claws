"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export interface FilterPillOption {
  value: string
  label: string
}

interface FilterPillsProps {
  options: readonly FilterPillOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function FilterPills({ options, value, onChange, className }: FilterPillsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const activePillRef = useRef<HTMLButtonElement | null>(null)

  // PR-5 defect 2: when a category is preselected (e.g. Swap → Browse),
  // scroll the active pill into the horizontal strip (centered).
  useEffect(() => {
    const pill = activePillRef.current
    if (!pill || typeof pill.scrollIntoView !== "function") return
    pill.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" })
  }, [value, options])

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollerRef}
        onWheel={(event) => {
          const scroller = scrollerRef.current
          if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          event.preventDefault()
          scroller.scrollLeft += event.deltaY
        }}
        className="flex gap-1.5 overflow-x-auto pb-1 pr-5 scrollbar-hide"
        data-testid="filter-pills-scroller"
      >
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value || "all"}
              type="button"
              ref={active ? (el) => { activePillRef.current = el } : undefined}
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              data-active={active ? "true" : undefined}
              className={cn(
                "text-[11px] font-medium px-[10px] py-[3px] rounded-[8px] border transition-colors cursor-pointer whitespace-nowrap shrink-0",
                active
                  ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
                  : "bg-transparent text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]",
              )}
            >
              <TruncatedText className="max-w-[120px]">{option.label}</TruncatedText>
            </button>
          )
        })}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-[calc(100%-4px)] w-6 bg-gradient-to-l from-[var(--bg)] to-transparent"
      />
    </div>
  )
}
