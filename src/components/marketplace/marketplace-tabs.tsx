"use client"

import { cn } from "@/lib/utils"

interface MarketplaceTabsProps {
  active: "templates" | "skills"
  onTabChange: (tab: "templates" | "skills") => void
}

const tabs = [
  { id: "templates" as const, label: "Templates" },
  { id: "skills" as const, label: "Skills" },
] as const

export function MarketplaceTabs({ active, onTabChange }: MarketplaceTabsProps) {
  return (
    <div
      className="flex gap-0 mb-4 border-b-2 border-[var(--bd)]"
      role="tablist"
      aria-label="Marketplace sections"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "px-4 py-2 text-[13px] cursor-pointer transition-colors -mb-[2px] border-b-2",
              isActive
                ? "font-semibold text-[var(--tx)] border-b-[var(--tx)]"
                : "font-medium text-[var(--tx2)] hover:text-[var(--tx)] border-transparent"
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
