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

function isAllOption(option: FilterPillOption): boolean {
  return option.value === "All" || option.value === "" || option.label.toLowerCase() === "all"
}

export function FilterPills({ options, value, onChange, className }: FilterPillsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const activePillRef = useRef<HTMLButtonElement | null>(null)

  const allOption = options.find(isAllOption)
  const clearValue = allOption?.value ?? "All"
  const scrollOptions = allOption
    ? options.filter((option) => option !== allOption)
    : [...options]

  // PR-5 defect 2: when a category is preselected (e.g. Swap → Browse),
  // scroll the active pill into the horizontal strip (centered).
  useEffect(() => {
    const pill = activePillRef.current
    if (!pill || typeof pill.scrollIntoView !== "function") return
    pill.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" })
  }, [value, options])

  function renderPill(option: FilterPillOption, sticky = false) {
    const active = value === option.value
    return (
      <button
        key={option.value || "all"}
        type="button"
        ref={active ? (el) => { activePillRef.current = el } : undefined}
        onClick={() => {
          // Active non-All pill → clear back to All (Batch C).
          if (active && option.value !== clearValue) {
            onChange(clearValue)
            return
          }
          onChange(option.value)
        }}
        aria-pressed={active}
        data-active={active ? "true" : undefined}
        data-sticky-all={sticky ? "true" : undefined}
        className={cn(
          "text-[11px] font-medium px-[10px] py-[3px] rounded-[8px] border transition-colors cursor-pointer whitespace-nowrap shrink-0",
          sticky && "sticky left-0 z-10 bg-[var(--bg)]",
          active
            ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
            : "bg-transparent text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]",
        )}
      >
        <TruncatedText className="max-w-[120px]">{option.label}</TruncatedText>
      </button>
    )
  }

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
        {allOption ? renderPill(allOption, true) : null}
        {scrollOptions.map((option) => renderPill(option))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-[calc(100%-4px)] w-6 bg-gradient-to-l from-[var(--bg)] to-transparent"
      />
    </div>
  )
}
