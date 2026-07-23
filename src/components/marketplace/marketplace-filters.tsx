"use client"

import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { FilterPills } from "@/components/ui/filter-pills"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SortOption } from "@/types/marketplace"

const TEMPLATE_CATEGORIES = [
  { value: "", label: "All" },
  { value: "MONEY_MAKING", label: "Money-Making" },
  { value: "CREATOR", label: "Creator" },
  { value: "BUSINESS_OPS", label: "Business Ops" },
  { value: "VERTICAL", label: "Vertical" },
  { value: "LIFESTYLE", label: "Lifestyle" },
] as const

const SKILL_CATEGORIES = [
  { value: "", label: "All" },
  { value: "Developer", label: "Developer" },
  { value: "Productivity", label: "Productivity" },
  { value: "System", label: "System" },
  { value: "Search", label: "Search" },
  { value: "Communication", label: "Communication" },
  { value: "Marketing", label: "Marketing" },
  { value: "Data", label: "Data" },
  { value: "CRM", label: "CRM" },
  { value: "Email", label: "Email" },
  { value: "Finance", label: "Finance" },
  { value: "Security", label: "Security" },
  { value: "Social", label: "Social" },
  { value: "Web", label: "Web" },
] as const

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low → High" },
  { value: "price_desc", label: "Price: High → Low" },
  { value: "rating", label: "Rating" },
]

interface MarketplaceFiltersProps {
  mode: "templates" | "skills"
  activeCategory: string
  priceFilter: "" | "free" | "paid"
  sort: SortOption
  onCategoryChange: (category: string) => void
  onPriceFilterChange: (filter: "" | "free" | "paid") => void
  onSortChange: (sort: SortOption) => void
  hideCategories?: boolean
}

function SortDropdown({ value, onChange }: { value: SortOption; onChange: (v: SortOption) => void }) {
  const label = SORT_OPTIONS.find(o => o.value === value)?.label ?? "Popular"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--tx2)] border border-[var(--bd)] rounded-[8px] px-3 py-[5px] hover:border-[var(--bd2)] bg-[var(--bg)] cursor-pointer"
          aria-label="Sort results"
        >
          Sort: {label}
          <ChevronDown className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4} collisionPadding={8} className="min-w-[160px]">
        {SORT_OPTIONS.map(option => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className={cn(
              "px-3 py-[6px] text-[11px]",
              value === option.value ? "font-semibold text-[var(--tx)]" : "text-[var(--tx2)]",
            )}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MarketplaceFilters({
  mode,
  activeCategory,
  priceFilter,
  sort,
  onCategoryChange,
  onPriceFilterChange,
  onSortChange,
  hideCategories,
}: MarketplaceFiltersProps) {
  const categories = mode === "templates" ? TEMPLATE_CATEGORIES : SKILL_CATEGORIES

  const pillClass = (active: boolean) => cn(
    "px-3 py-1 text-[10px] font-medium rounded-[8px] border transition-colors cursor-pointer",
    active
      ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
      : "bg-[var(--bg)] text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]"
  )

  return (
    <div className="mt-2 mb-3" role="toolbar" aria-label="Filter options">
      {/* Row 1: Category pills - allowed to wrap (hidden when categories are surfaced elsewhere) */}
      {!hideCategories && (
        <FilterPills
          options={categories}
          value={activeCategory}
          onChange={onCategoryChange}
          className="mb-2"
        />
      )}

      {/* Row 2: Price toggles + Sort dropdown */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[6px]">
          {(["free", "paid"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => onPriceFilterChange(priceFilter === filter ? "" : filter)}
              className={cn(pillClass(priceFilter === filter), "capitalize")}
              aria-pressed={priceFilter === filter}
            >
              {filter}
            </button>
          ))}
        </div>
        <SortDropdown value={sort} onChange={onSortChange} />
      </div>
    </div>
  )
}
