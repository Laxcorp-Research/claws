"use client"

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { Tooltip } from "./tooltip"

interface BadgeProps {
  children: ReactNode
  variant?: "neutral" | "warning" | "info" | "success" | "error"
  /** When set, shows a DS Tooltip on hover (replaces native title=). */
  title?: string
  className?: string
}

const variantClasses = {
  neutral: "bg-[var(--bg3)] text-[var(--tx2)] border-[var(--bd)]",
  warning: "bg-[var(--warnbg)] text-[var(--warn)] border-[var(--warn)]",
  info: "bg-[var(--acbg)] text-[var(--ac-text)] border-[var(--ac)]",
  success: "bg-[#dcfce7] text-[#10b981] border-[#86efac]",
  error: "bg-[var(--errbg)] text-[var(--err)] border-[var(--err)]",
} as const

export function Badge({ children, variant = "neutral", title, className }: BadgeProps) {
  const badge = (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium px-2 py-[2px] rounded-md border leading-tight",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )

  if (!title) return badge

  return (
    <Tooltip content={title} align="center" triggerClassName="inline-flex w-auto shrink-0">
      {badge}
    </Tooltip>
  )
}
