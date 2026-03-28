"use client"

import { cn } from "@/lib/utils"
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
  { value: "CORE", label: "Core" },
  { value: "CRM", label: "CRM" },
  { value: "EMAIL_SENDER", label: "Email" },
  { value: "SOCIAL", label: "Social" },
  { value: "CALENDAR", label: "Calendar" },
  { value: "PROJECT_MGMT", label: "Project Mgmt" },
  { value: "ANALYTICS", label: "Analytics" },
  { value: "SEARCH", label: "Search" },
  { value: "FINANCE", label: "Finance" },
  { value: "TRADING", label: "Trading" },
  { value: "CONTENT", label: "Content" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "SECURITY", label: "Security" },
] as const

interface MarketplaceFiltersProps {
  mode: "templates" | "skills"
  activeCategory: string
  priceFilter: "" | "free" | "paid"
  sort: SortOption
  onCategoryChange: (category: string) => void
  onPriceFilterChange: (filter: "" | "free" | "paid") => void
  onSortChange: (sort: SortOption) => void
}

export function MarketplaceFilters({
  mode,
  activeCategory,
  priceFilter,
  sort,
  onCategoryChange,
  onPriceFilterChange,
  onSortChange,
}: MarketplaceFiltersProps) {
  const categories = mode === "templates" ? TEMPLATE_CATEGORIES : SKILL_CATEGORIES

  return (
    <div className="flex gap-[6px] items-center mt-2 mb-3 flex-wrap" role="toolbar" aria-label="Filter options">
      {categories.map((cat) => (
        <button
          key={cat.value}
          onClick={() => onCategoryChange(cat.value)}
          className={cn(
            "px-3 py-1 text-[10px] font-medium rounded-[8px] border transition-colors",
            activeCategory === cat.value
              ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
              : "bg-[var(--bg)] text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]"
          )}
          aria-pressed={activeCategory === cat.value}
        >
          {cat.label}
        </button>
      ))}

      <div className="w-px h-4 bg-[var(--bd)] mx-1" aria-hidden="true" />

      {(["free", "paid"] as const).map((filter) => (
        <button
          key={filter}
          onClick={() => onPriceFilterChange(priceFilter === filter ? "" : filter)}
          className={cn(
            "px-3 py-1 text-[10px] font-medium rounded-[8px] border transition-colors capitalize",
            priceFilter === filter
              ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
              : "bg-[var(--bg)] text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]"
          )}
          aria-pressed={priceFilter === filter}
        >
          {filter}
        </button>
      ))}

      <div className="w-px h-4 bg-[var(--bd)] mx-1" aria-hidden="true" />

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="text-[10px] py-[3px] px-2 border border-[var(--bd)] rounded-[6px] bg-[var(--bg)] text-[var(--tx)]"
        aria-label="Sort results"
      >
        <option value="popular">Sort: Popular</option>
        <option value="newest">Newest</option>
        <option value="price_asc">Price: Low to High</option>
        <option value="price_desc">Price: High to Low</option>
        <option value="rating">Rating</option>
      </select>
    </div>
  )
}
