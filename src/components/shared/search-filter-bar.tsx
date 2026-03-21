"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface SearchFilterBarProps {
  searchValue: string
  onSearchChange: (val: string) => void
  filters: string[]
  activeFilter: string
  onFilterChange: (filter: string) => void
  searchPlaceholder?: string
}

export function SearchFilterBar({
  searchValue,
  onSearchChange,
  filters,
  activeFilter,
  onFilterChange,
  searchPlaceholder = "Search...",
}: SearchFilterBarProps) {
  return (
    <div className="flex items-center gap-3 mb-3.5">
      <Input
        variant="search"
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        className="max-w-[220px]"
      />
      <div className="flex gap-1.5 flex-wrap">
        {filters.map((filter) => (
          <Button
            key={filter}
            variant={activeFilter === filter ? "primary" : "outline"}
            size="sm"
            onClick={() => onFilterChange(filter)}
          >
            {filter}
          </Button>
        ))}
      </div>
    </div>
  )
}
