"use client"

import { useState, useMemo, useEffect } from "react"
import { PageShell } from "@/components/shared/page-shell"
import { CategoryBadge, type ClawCategory } from "@/components/ui/category-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ClawCard, type ClawCardData } from "@/components/store/claw-card"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { cn } from "@/lib/utils"

const CATEGORIES: (ClawCategory | "ALL")[] = ["ALL", "MONEY_MAKING", "CREATOR", "BUSINESS_OPS", "VERTICAL", "LIFESTYLE"]

const CATEGORY_META: Record<ClawCategory, { label: string; description: string }> = {
  MONEY_MAKING: { label: "Money-Making", description: "AI teams that directly generate or protect revenue" },
  CREATOR: { label: "Creator", description: "Content creation, audience growth, and monetization" },
  BUSINESS_OPS: { label: "Business Ops", description: "Sales, operations, and internal productivity" },
  VERTICAL: { label: "Vertical", description: "Industry-specific teams with compliance built in" },
  LIFESTYLE: { label: "Lifestyle", description: "Personal productivity, health, learning, and career" },
}

interface TemplateData extends ClawCardData {
  category: ClawCategory
  description: string
}

export default function StorePage() {
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<ClawCategory | "ALL">("ALL")

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setTemplates(json.data.templates)
      })
      .finally(() => setLoading(false))
  }, [])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of templates) counts[t.category] = (counts[t.category] ?? 0) + 1
    return counts
  }, [templates])

  const filteredClaws = useMemo(() => {
    let claws = templates
    if (activeCategory !== "ALL") claws = claws.filter((c) => c.category === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      claws = claws.filter((c) => c.name.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    }
    return claws
  }, [templates, search, activeCategory])

  const filteredByCategory = useMemo(() => {
    const grouped: Partial<Record<ClawCategory, TemplateData[]>> = {}
    const order: ClawCategory[] = ["MONEY_MAKING", "CREATOR", "BUSINESS_OPS", "VERTICAL", "LIFESTYLE"]
    for (const cat of order) {
      const catClaws = filteredClaws.filter((c) => c.category === cat)
      if (catClaws.length > 0) grouped[cat] = catClaws
    }
    return grouped
  }, [filteredClaws])

  return (
    <PageShell background="secondary">
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="text-center pt-5 pb-4">
          <div className="text-xl font-semibold text-[var(--tx)]">AI agents that work while you sleep</div>
          <div className="text-[13px] text-[var(--tx2)] mt-1 max-w-[500px] mx-auto">
            Pre-built multi-agent teams. Connect your tools, deploy in 10 minutes, monitor from your phone.
          </div>

          <div className="mt-3">
            <input
              type="text"
              placeholder="Search Claws..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3.5 py-2 border border-[var(--bd)] rounded-[8px] bg-[var(--bg)] text-[12px] w-[280px] placeholder:text-[var(--tx3)] focus:outline-none focus:ring-2 focus:ring-[var(--tx)]/10 focus:border-[var(--tx)] transition-colors"
            />
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-2.5 flex-wrap">
            {CATEGORIES.map((cat) => {
              const count = cat === "ALL" ? templates.length : categoryCounts[cat] || 0
              const label = cat === "ALL" ? "All" : CATEGORY_META[cat].label
              const isActive = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "text-[10px] font-medium px-3 py-1 rounded-[8px] transition-colors",
                    isActive ? "bg-[var(--tx)] text-white" : "bg-transparent border border-[var(--bd)] text-[var(--tx2)] hover:bg-[var(--bg2)]"
                  )}
                >
                  {label}{count > 0 && ` (${count})`}
                </button>
              )
            })}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2.5">
            <LoadingSkeleton variant="card" count={3} />
          </div>
        ) : filteredClaws.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={`No Claws match "${search}"`}
            description="Try different keywords, or browse all categories."
            actions={<Button variant="outline" onClick={() => { setSearch(""); setActiveCategory("ALL") }}>Clear search</Button>}
          />
        ) : (
          <div className="space-y-6">
            {(Object.entries(filteredByCategory) as [ClawCategory, TemplateData[]][]).map(([category, claws]) => (
              <section key={category}>
                <div className="mb-2">
                  <CategoryBadge category={category} />
                  <div className="text-[11px] text-[var(--tx2)] mt-1 mb-2">{CATEGORY_META[category].description}</div>
                </div>
                <div className="space-y-2.5">
                  {claws.map((claw) => {
                    const globalIndex = filteredClaws.indexOf(claw) + 1
                    return <ClawCard key={claw.slug} claw={claw} index={globalIndex} />
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}
