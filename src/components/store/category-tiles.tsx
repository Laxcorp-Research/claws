"use client"

import { LayoutGrid, TrendingUp, Palette, Briefcase, Building2, Sun, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface CategoryTilesProps {
  activeCategory: string
  onSelect: (category: string) => void
}

const CATEGORIES: { value: string; label: string; description: string; Icon: LucideIcon }[] = [
  { value: "", label: "All", description: "Every template", Icon: LayoutGrid },
  { value: "MONEY_MAKING", label: "Money-Making", description: "Revenue-generating teams", Icon: TrendingUp },
  { value: "CREATOR", label: "Creator", description: "Content, audience & growth", Icon: Palette },
  { value: "BUSINESS_OPS", label: "Business Ops", description: "Run & automate ops", Icon: Briefcase },
  { value: "VERTICAL", label: "Vertical", description: "Industry-specific teams", Icon: Building2 },
  { value: "LIFESTYLE", label: "Lifestyle", description: "Personal & everyday", Icon: Sun },
]

export function CategoryTiles({ activeCategory, onSelect }: CategoryTilesProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
      {CATEGORIES.map(({ value, label, description, Icon }) => {
        const active = activeCategory === value
        return (
          <button
            key={value || "all"}
            type="button"
            onClick={() => onSelect(value)}
            aria-pressed={active}
            className={cn(
              "group flex items-center gap-3 rounded-[12px] border p-4 text-left transition-colors cursor-pointer",
              active
                ? "border-[var(--tx)] bg-[var(--bg)]"
                : "border-[var(--bd)] bg-[var(--bg)] hover:border-[var(--bd2)]"
            )}
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] transition-colors",
                active ? "bg-[var(--tx)]" : "bg-[var(--bg2)] group-hover:bg-[var(--bg3)]"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-colors",
                  active ? "text-[var(--bg)]" : "text-[var(--tx2)] group-hover:text-[var(--tx)]"
                )}
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-[var(--tx)]">{label}</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-[var(--tx3)]">{description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
