"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { AlertBanner } from "@/components/ui/alert-banner"
import { WorkspaceCard } from "@/components/my-claws/workspace-card"
import { SearchFilterBar } from "@/components/shared/search-filter-bar"
import { mapWorkspaceStatus, timeAgo } from "@/lib/utils"
import { Bot, Search, Loader2 } from "lucide-react"
import Link from "next/link"

interface ApiWorkspace {
  id: string
  name: string
  status: string
  updatedAt: string
  currentMonthApiCost: number
  clawTemplateId: string | null
  clawTemplate: { name: string; category: string } | null
  agents: { role: string }[]
  _count: { agents: number }
}

interface WorkspaceItem {
  id: string
  name: string
  status: "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped"
  apiStatus: string
  agentCount: number
  agentRoles: string[]
  lastActive: string | undefined
  monthlyCost: string | undefined
  source: string
}

function toWorkspaceItem(w: ApiWorkspace): WorkspaceItem {
  const status = mapWorkspaceStatus(w.status)
  return {
    id: w.id,
    name: w.name,
    status,
    apiStatus: w.status,
    agentCount: w._count.agents,
    agentRoles: w.agents?.map(a => a.role) || [],
    lastActive: w.updatedAt ? timeAgo(w.updatedAt) : undefined,
    monthlyCost: w.currentMonthApiCost > 0 ? `$${w.currentMonthApiCost.toFixed(2)}` : undefined,
    source: w.clawTemplate ? "From template" : "Custom",
  }
}

const FILTERS = ["All", "Running", "Paused", "Error", "Draft", "Setup"]

export default function MyClawsPage() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("All")
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreatorEnrolled, setIsCreatorEnrolled] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [isRenaming, setIsRenaming] = useState(false)

  useEffect(() => { setDeleteConfirmText("") }, [deleteTarget])

  useEffect(() => {
    fetch("/api/creator/profile")
      .then(res => res.json())
      .then(data => { if ((data.data || data)?.id) setIsCreatorEnrolled(true) })
      .catch(() => {})
  }, [])

  async function handleCreateCustomClaw() {
    if (isCreating) return
    setIsCreating(true)
    setCreateError(null)
    try {
      const count = workspaces?.length ?? 0
      const name = `My Claw ${count + 1}`
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || `Failed to create workspace (${res.status})`)
      const workspaceId = data.data?.id || data.id
      if (workspaceId) router.push(`/builder/${workspaceId}`)
      else throw new Error("No workspace ID returned")
    } catch (err) {
      console.error("Failed to create custom Claw:", err)
      setCreateError(err instanceof Error ? err.message : "Failed to create workspace")
    } finally {
      setIsCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || isDeleting || deleteConfirmText !== deleteTarget.name) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/workspaces/${deleteTarget.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      setWorkspaces(prev => prev ? prev.filter(w => w.id !== deleteTarget.id) : prev)
      setDeleteTarget(null)
      setDeleteConfirmText("")
    } catch (err) {
      console.error("Failed to delete workspace:", err)
    } finally {
      setIsDeleting(false)
    }
  }

  function openRename(id: string, currentName: string) {
    setRenameTarget({ id, name: currentName })
    setRenameValue(currentName)
  }

  async function handleRename() {
    if (!renameTarget || isRenaming || !renameValue.trim()) return
    setIsRenaming(true)
    try {
      const res = await fetch(`/api/workspaces/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      if (!res.ok) throw new Error("Failed to rename")
      setWorkspaces(prev => prev ? prev.map(w => w.id === renameTarget.id ? { ...w, name: renameValue.trim() } : w) : prev)
      setRenameTarget(null)
    } catch (err) {
      console.error("Failed to rename:", err)
    } finally {
      setIsRenaming(false)
    }
  }

  async function handleDuplicate(id: string) {
    try {
      const res = await fetch(`/api/workspaces/${id}/duplicate`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to duplicate")
      fetchWorkspaces()
    } catch (err) {
      console.error("Failed to duplicate:", err)
    }
  }

  const fetchWorkspaces = useCallback(async () => {
    setError(null)
    setWorkspaces(null)
    try {
      const res = await fetch("/api/workspaces")
      if (!res.ok) throw new Error("Failed to fetch")
      const json = await res.json()
      const items = ((json.data ?? []) as ApiWorkspace[]).map(toWorkspaceItem)
      setWorkspaces(items)
    } catch {
      setError("Failed to load your Claws")
      setWorkspaces([])
    }
  }, [])

  useEffect(() => { fetchWorkspaces() }, [fetchWorkspaces])

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
              <Button variant="primary" loading={isCreating} onClick={handleCreateCustomClaw}>
                {isCreating ? "Creating..." : "+ Create custom Claw"}
              </Button>
            </>
          }
        />

        {createError && <p className="text-[12px] text-[var(--err)] mb-2">{createError}</p>}

        {error && (
          <AlertBanner variant="error" actions={<Button variant="outline" size="sm" onClick={fetchWorkspaces}>Retry</Button>}>
            <div className="font-medium">{error}</div>
            <div className="text-[11px] mt-0.5 opacity-80">Something went wrong. Please try again.</div>
          </AlertBanner>
        )}

        {filtered === null && !error && (
          <div className="grid grid-cols-3 gap-2.5">
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="card" />
          </div>
        )}

        {filtered && filtered.length === 0 && !search && activeFilter === "All" && !error && (
          <EmptyState
            icon={<Bot className="w-10 h-10" />}
            title="You don't have any Claws yet"
            description="Browse pre-built agent teams or create your own from scratch."
            bordered
            actions={
              <>
                <Link href="/store"><Button variant="primary">Browse the store</Button></Link>
                <Button variant="outline" loading={isCreating} onClick={handleCreateCustomClaw}>
                  {isCreating ? "Creating..." : "Create custom Claw"}
                </Button>
              </>
            }
          />
        )}

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

        {filtered && filtered.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {filtered.map((w) => (
              <WorkspaceCard
                key={w.id}
                {...w}
                isCreatorEnrolled={isCreatorEnrolled}
                onRename={openRename}
                onDuplicate={handleDuplicate}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            ))}
          </div>
        )}

        {filtered && filtered.length === 0 && (search || activeFilter !== "All") && !error && (
          <EmptyState
            icon={<Search className="w-10 h-10" />}
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

      {/* Delete confirmation - type name to confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => { if (!isDeleting) { setDeleteTarget(null); setDeleteConfirmText("") } }} />
          <div className="relative bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] p-[20px] shadow-modal max-w-[400px] w-full mx-[16px]">
            <h3 className="text-[15px] font-semibold text-[var(--tx)] mb-[6px]">Delete workspace</h3>
            <div className="bg-[var(--errbg)] border border-[var(--err)] rounded-[6px] p-[10px] mb-[14px]">
              <p className="text-[11px] text-[#991b1b] leading-[1.5]">
                This will permanently delete <span className="font-semibold">&ldquo;{deleteTarget.name}&rdquo;</span> including all agents, connections, skills, version history, and deployment data. This action cannot be undone.
              </p>
            </div>
            <label className="text-[12px] text-[var(--tx2)] block mb-[4px]">
              Type <span className="font-semibold text-[var(--tx)]">{deleteTarget.name}</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget.name}
              className="w-full px-[10px] py-[8px] border border-[var(--bd)] rounded-[6px] text-[12px] bg-[var(--bg)] text-[var(--tx)] mb-[14px] focus:border-[var(--err)] focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && deleteConfirmText === deleteTarget.name) handleDelete() }}
            />
            <div className="flex gap-[6px] justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteConfirmText("") }} disabled={isDeleting} className="px-[12px] py-[6px] text-[12px] text-[var(--tx2)] border border-[var(--bd)] rounded-[6px] hover:bg-[var(--bg2)] transition-colors disabled:opacity-50 cursor-pointer bg-transparent">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={isDeleting || deleteConfirmText !== deleteTarget.name} className="px-[12px] py-[6px] text-[12px] text-white bg-[var(--err)] rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-[4px] cursor-pointer border-none">
                {isDeleting ? (<><Loader2 className="w-[12px] h-[12px] animate-spin" />Deleting...</>) : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRenameTarget(null)} />
          <div className="relative bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] p-[20px] shadow-modal max-w-[360px] w-full mx-[16px]">
            <h3 className="text-[15px] font-semibold text-[var(--tx)] mb-[10px]">Rename workspace</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-[10px] py-[8px] border border-[var(--bd)] rounded-[6px] text-[12px] bg-[var(--bg)] text-[var(--tx)] mb-[14px] focus:border-[var(--tx)] focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) handleRename() }}
            />
            <div className="flex gap-[6px] justify-end">
              <button onClick={() => setRenameTarget(null)} className="px-[12px] py-[6px] text-[12px] text-[var(--tx2)] border border-[var(--bd)] rounded-[6px] hover:bg-[var(--bg2)] cursor-pointer bg-transparent">
                Cancel
              </button>
              <button onClick={handleRename} disabled={isRenaming || !renameValue.trim()} className="px-[12px] py-[6px] text-[12px] text-white bg-[var(--tx)] rounded-[6px] hover:opacity-90 disabled:opacity-50 flex items-center gap-[4px] cursor-pointer border-none">
                {isRenaming ? "Saving..." : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
