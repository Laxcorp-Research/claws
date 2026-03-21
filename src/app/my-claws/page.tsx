"use client"

import { useState, useMemo } from "react"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { WorkspaceCard } from "@/components/my-claws/workspace-card"
import { SearchFilterBar } from "@/components/shared/search-filter-bar"
import Link from "next/link"

const DEMO_WORKSPACES = [
  { id: "ws_1", name: "B2B Sales Machine", status: "running" as const, agentCount: 7, lastActive: "12 min ago", monthlyCost: "$47.20", source: "From template" },
  { id: "ws_2", name: "YouTube Channel OS", status: "setup" as const, agentCount: 8, lastActive: undefined, monthlyCost: undefined, source: "From template" },
  { id: "ws_3", name: "Custom SEO Bot", status: "draft" as const, agentCount: 3, lastActive: "2 days ago", monthlyCost: "$0", source: "Custom" },
]

// Toggle to test states: "populated" | "empty" | "loading"
const DEMO_STATE: "populated" | "empty" | "loading" = "populated"

const FILTERS = ["All", "Running", "Paused", "Error", "Draft", "Setup"]

export default function MyClawsPage() {
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("All")

  const workspaces = DEMO_STATE === "empty" ? [] : DEMO_STATE === "loading" ? null : DEMO_WORKSPACES

  const filtered = useMemo(() => {
    if (!workspaces) return null
    let result = workspaces
    if (activeFilter !== "All") {
      result = result.filter((w) => w.status.toLowerCase() === activeFilter.toLowerCase())
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((w) => w.name.toLowerCase().includes(q))
    }
    return result
  }, [workspaces, activeFilter, search])

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto px-4 py-4">
        <PageHeader
          title="My Claws"
          actions={
            <>
              <Link href="/store">
                <Button variant="outline">Browse store</Button>
              </Link>
              <Button variant="primary">+ Create custom Claw</Button>
            </>
          }
        />

        {/* Loading state */}
        {filtered === null && (
          <div className="grid grid-cols-3 gap-2.5">
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
          </div>
        )}

        {/* Empty state */}
        {filtered && filtered.length === 0 && !search && activeFilter === "All" && (
          <EmptyState
            icon="🤖"
            title="You don't have any Claws yet"
            description="Browse pre-built agent teams or create your own from scratch."
            bordered
            actions={
              <>
                <Link href="/store"><Button variant="primary">Browse the store</Button></Link>
                <Button variant="outline">Create custom Claw</Button>
              </>
            }
          />
        )}

        {/* Filter bar — show when 3+ workspaces or actively filtering */}
        {filtered && (workspaces && workspaces.length >= 3 || search || activeFilter !== "All") && (
          <SearchFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            filters={FILTERS}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            searchPlaceholder="Search workspaces..."
          />
        )}

        {/* Workspace grid */}
        {filtered && filtered.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {filtered.map((w) => (
              <WorkspaceCard key={w.id} {...w} />
            ))}
          </div>
        )}

        {/* Search/filter no results */}
        {filtered && filtered.length === 0 && (search || activeFilter !== "All") && (
          <EmptyState
            icon="🔍"
            title="No workspaces match your filters"
            description="Try different search terms or clear your filters."
            actions={
              <Button variant="outline" onClick={() => { setSearch(""); setActiveFilter("All") }}>
                Clear filters
              </Button>
            }
          />
        )}
      </div>
    </PageShell>
  )
}
