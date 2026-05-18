"use client"

import { useState, useMemo, useEffect } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusDot } from "@/components/ui/status-dot"
import { CredentialsModal } from "./credentials-modal"
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDefinition } from "@/data/tool-catalog"

interface BrowseToolsModalProps {
  open: boolean
  onClose: () => void
  connectedSlugs: string[]
  onConnect: (tool: ToolDefinition) => void
  /** Real Composio OAuth (popup + poll); must match server COMPOSIO_API_KEY */
  composioOAuthAvailable: boolean
  onOAuthConnect: (tool: ToolDefinition) => void
  workspaceId?: string
}

export function BrowseToolsModal({
  open,
  onClose,
  connectedSlugs,
  onConnect,
  composioOAuthAvailable,
  onOAuthConnect,
  workspaceId,
}: BrowseToolsModalProps) {
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [apiKeyTool, setApiKeyTool] = useState<ToolDefinition | null>(null)
  const [localConnected, setLocalConnected] = useState<Set<string>>(new Set())
  const [remoteTools, setRemoteTools] = useState<ToolDefinition[] | null>(null)
  const [remoteCategories, setRemoteCategories] = useState<string[] | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)

  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    setBrowseLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/tools/${workspaceId}/browse`)
        const data = await res.json()
        if (cancelled || !data.success) return
        setRemoteTools(data.data.tools as ToolDefinition[])
        setRemoteCategories(data.data.categories as string[])
      } catch {
        if (!cancelled) {
          setRemoteTools(ALL_TOOLS)
          setRemoteCategories([...TOOL_CATEGORIES])
        }
      } finally {
        if (!cancelled) setBrowseLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, workspaceId])

  const tools = remoteTools ?? ALL_TOOLS
  const categoryList = remoteCategories ?? [...TOOL_CATEGORIES]

  // PR2.8a-fix1 Task 7: belt-and-suspenders comingSoon filter. The browse
  // server endpoint already filters comingSoon entries from its payload, but
  // when the fetch fails we fall back to the static `ALL_TOOLS` import which
  // includes them — surfacing them here would let users click Connect on
  // toolkits that 422 at the route. Filter again client-side to close that
  // gap. Hidden until each toolkit's catalog entry ships with comingSoon=false.
  const filtered = useMemo(() => {
    return tools.filter((tool) => {
      if (tool.comingSoon) return false
      const matchesSearch =
        !search ||
        tool.name.toLowerCase().includes(search.toLowerCase()) ||
        tool.slug.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = activeCategory === "All" || tool.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [tools, search, activeCategory])

  const allConnected = useMemo(() => new Set([...connectedSlugs, ...localConnected]), [connectedSlugs, localConnected])

  function handleToolClick(tool: ToolDefinition) {
    if (tool.connectionType === "API_KEY") {
      setApiKeyTool(tool)
    } else if (tool.connectionType === "OAUTH_COMPOSIO" && composioOAuthAvailable) {
      onOAuthConnect(tool)
    }
  }

  const categoryPills = useMemo(() => {
    const withAll = categoryList.includes("All") ? categoryList : ["All", ...categoryList]
    return withAll.slice(0, 24)
  }, [categoryList])

  function formatCategory(raw: string): string {
    if (raw === "All") return raw
    return raw
      .split("_")
      .map((w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(" ")
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Browse tools"
        description={
          browseLoading
            ? "Loading catalog…"
            : `Browse ${tools.length} tools. Curated list first; Composio catalog fills in when configured.`
        }
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-[var(--tx3)]">{filtered.length} tools</span>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        <div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            className="mb-2.5"
            disabled={browseLoading}
          />
          <div className="flex gap-1.5 mb-2.5 overflow-x-auto pb-1 scrollbar-hide">
            {categoryPills.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`text-[11px] font-medium px-[10px] py-[3px] rounded-[8px] border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeCategory === cat
                    ? "bg-[var(--tx)] text-[var(--bg)] border-[var(--tx)]"
                    : "bg-transparent text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--bd2)]"
                }`}
              >
                {formatCategory(cat)}
              </button>
            ))}
          </div>
          <div className="border border-[var(--bd)] rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            {browseLoading && (
              <div className="px-3.5 py-6 text-center text-xs text-[var(--tx3)]">Loading tools…</div>
            )}
            {!browseLoading && filtered.length === 0 && (
              <div className="px-3.5 py-6 text-center text-xs text-[var(--tx3)]">No tools found.</div>
            )}
            {!browseLoading &&
              filtered.map((tool) => {
                const isConnected = allConnected.has(tool.slug)
                return (
                  <div
                    key={tool.slug}
                    className="flex items-center gap-3 px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <StatusDot status={isConnected ? "connected" : "disconnected"} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{tool.name}</div>
                        <div className="text-[10px] text-[var(--tx2)] truncate">
                          {tool.description || tool.category}
                        </div>
                      </div>
                    </div>
                    {isConnected ? (
                      <span className="text-[10px] text-[var(--ok)] font-medium shrink-0">Connected</span>
                    ) : tool.connectionType === "OAUTH_COMPOSIO" ? (
                      composioOAuthAvailable ? (
                        <button
                          type="button"
                          onClick={() => handleToolClick(tool)}
                          className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity cursor-pointer border-none shrink-0"
                        >
                          Connect OAuth
                        </button>
                      ) : (
                        <span className="text-[10px] text-[var(--tx3)] px-[8px] py-[3px] border border-[var(--bd)] rounded-[4px] shrink-0">
                          OAuth not configured
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToolClick(tool)}
                        className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity cursor-pointer border-none shrink-0"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      </Modal>

      {apiKeyTool && (
        <CredentialsModal
          open={true}
          onClose={() => setApiKeyTool(null)}
          toolName={apiKeyTool.name}
          helpUrl={apiKeyTool.helpUrl}
          credentialFields={apiKeyTool.credentialFields}
          onSave={async (credentials) => {
            if (!workspaceId) return { success: false, error: "No workspace" }
            try {
              const res = await fetch(`/api/tools/${workspaceId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  toolSlug: apiKeyTool.slug,
                  displayName: apiKeyTool.name,
                  connectionType: "API_KEY",
                  credentials,
                }),
              })
              const data = await res.json()
              if (data.success) {
                setLocalConnected((prev) => new Set([...prev, apiKeyTool.slug]))
                onConnect(apiKeyTool)
                setApiKeyTool(null)
                return { success: true }
              }
              return { success: false, error: data.error?.message || "Failed to connect" }
            } catch {
              return { success: false, error: "Network error" }
            }
          }}
        />
      )}
    </>
  )
}
