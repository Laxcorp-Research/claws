"use client"

import { useRef } from "react"
import { cn } from "@/lib/utils"

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
      >
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={cn(
                "text-[11px] font-medium px-[10px] py-[3px] rounded-[8px] border transition-colors cursor-pointer whitespace-nowrap shrink-0",
                active
                  ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
                  : "bg-transparent text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]",
              )}
            >
              {option.label}
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
