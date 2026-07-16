"use client"

import {
  LayoutGrid,
  TrendingUp,
  Palette,
  Briefcase,
  Building2,
  Sun,
  Code2,
  Zap,
  Settings,
  Search,
  MessageSquare,
  Megaphone,
  Database,
  Contact,
  Mail,
  Wallet,
  Shield,
  AtSign,
  Globe,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface CategoryDef {
  value: string
  label: string
  description?: string
  Icon: LucideIcon
}

export const TEMPLATE_CATEGORIES: CategoryDef[] = [
  { value: "", label: "All", description: "Every template", Icon: LayoutGrid },
  { value: "MONEY_MAKING", label: "Money-Making", description: "Revenue-generating teams", Icon: TrendingUp },
  { value: "CREATOR", label: "Creator", description: "Content, audience & growth", Icon: Palette },
  { value: "BUSINESS_OPS", label: "Business Ops", description: "Run & automate ops", Icon: Briefcase },
  { value: "VERTICAL", label: "Vertical", description: "Industry-specific teams", Icon: Building2 },
  { value: "LIFESTYLE", label: "Lifestyle", description: "Personal & everyday", Icon: Sun },
]

export const SKILL_CATEGORIES: CategoryDef[] = [
  { value: "", label: "All", Icon: LayoutGrid },
  { value: "Developer", label: "Developer", Icon: Code2 },
  { value: "Productivity", label: "Productivity", Icon: Zap },
  { value: "System", label: "System", Icon: Settings },
  { value: "Search", label: "Search", Icon: Search },
  { value: "Communication", label: "Communication", Icon: MessageSquare },
  { value: "Marketing", label: "Marketing", Icon: Megaphone },
  { value: "Data", label: "Data", Icon: Database },
  { value: "CRM", label: "CRM", Icon: Contact },
  { value: "Email", label: "Email", Icon: Mail },
  { value: "Finance", label: "Finance", Icon: Wallet },
  { value: "Security", label: "Security", Icon: Shield },
  { value: "Social", label: "Social", Icon: AtSign },
  { value: "Web", label: "Web", Icon: Globe },
]

interface CategoryTilesProps {
  categories: CategoryDef[]
  activeCategory: string
  onSelect: (category: string) => void
  size?: "default" | "compact"
}

export function CategoryTiles({ categories, activeCategory, onSelect, size = "default" }: CategoryTilesProps) {
  const compact = size === "compact"

  return (
    <div
      className={cn(
        // Compact: content-sized chips that center-wrap (no dead space, no ragged row).
        // Default: fixed grid with room for a description line.
        compact
          ? "flex flex-wrap justify-center gap-2"
          : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5"
      )}
    >
      {categories.map(({ value, label, description, Icon }) => {
        const active = activeCategory === value
        return (
          <button
            key={value || "all"}
            type="button"
            onClick={() => onSelect(value)}
            aria-pressed={active}
            className={cn(
              "group flex items-center text-left transition-colors cursor-pointer border",
              compact ? "gap-2 rounded-[10px] px-3 py-2" : "gap-3 rounded-[12px] p-4",
              active
                ? "border-[var(--tx)] bg-[var(--bg)]"
                : "border-[var(--bd)] bg-[var(--bg)] hover:border-[var(--bd2)]"
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center transition-colors",
                compact ? "h-7 w-7 rounded-[7px]" : "h-10 w-10 rounded-[10px]",
                active ? "bg-[var(--tx)]" : "bg-[var(--bg2)] group-hover:bg-[var(--bg3)]"
              )}
            >
              <Icon
                className={cn(
                  "transition-colors",
                  compact ? "h-[15px] w-[15px]" : "h-5 w-5",
                  active ? "text-[var(--bg)]" : "text-[var(--tx2)] group-hover:text-[var(--tx)]"
                )}
                aria-hidden="true"
              />
            </span>
            {compact ? (
              <span className="whitespace-nowrap text-[12px] font-medium leading-tight text-[var(--tx)]">{label}</span>
            ) : (
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight text-[var(--tx)]">{label}</span>
                {description && (
                  <span className="mt-0.5 block text-[11px] leading-tight text-[var(--tx3)]">{description}</span>
                )}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
