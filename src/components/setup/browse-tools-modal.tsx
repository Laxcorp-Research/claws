"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FilterPills } from "@/components/ui/filter-pills"
import { Input } from "@/components/ui/input"
import { StatusDot } from "@/components/ui/status-dot"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { CredentialsModal } from "./credentials-modal"
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDefinition } from "@/data/tool-catalog"

export type BrowseToolsModalMode = "browse" | "swap"

interface BrowseToolsModalProps {
  open: boolean
  onClose: () => void
  connectedSlugs: string[]
  onConnect: (tool: ToolDefinition) => void
  /** Real Composio OAuth (popup + poll); must match server COMPOSIO_API_KEY */
  composioOAuthAvailable: boolean
  /**
   * Click handler for OAUTH_COMPOSIO rows. Routes through the wizard's
   * `useOAuthConnection.connect()` flow, which itself branches at the
   * initiate-response layer between true OAuth (popup + poll) and BYOK
   * (apiKeyForm via `onApiKeyFormRequired`). The modal does NOT
   * differentiate the two at click time — detection is server-side per
   * PR2.9 design (decision 3) to avoid duplicating it across surfaces.
   *
   * `onByokConnect` exists as a parallel prop for future-proofing: if
   * we later add a browse-time hint (catalog field, metadata cache),
   * the modal can route true-OAuth vs BYOK clicks separately without an
   * architecture change. Today both props can wire to the same wizard
   * handler — the parallel prop is shape, not behavior.
   */
  onOAuthConnect: (tool: ToolDefinition) => void
  onByokConnect?: (tool: ToolDefinition) => void
  workspaceId?: string
  pendingOAuthSlug?: string | null
  oauthErrors?: Record<string, string | undefined>
  /** Default browse; swap = replace requirement-set row (not plain-add). */
  mode?: BrowseToolsModalMode
  /** Pre-select category filter when opening (swap uses the row's category). */
  initialCategory?: string
  /** Template-curated alternatives[] — pinned under "Suggested". */
  suggestedSlugs?: string[]
  /** Current row slug excluded from the list in swap mode. */
  excludeSlug?: string
  /** Swap selection — requirement-set replace; not connect. */
  onSwapSelect?: (tool: ToolDefinition) => void
  /** Display name of the tool being replaced (swap title). */
  swapCurrentName?: string
}

export function BrowseToolsModal({
  open,
  onClose,
  connectedSlugs,
  onConnect,
  composioOAuthAvailable,
  onOAuthConnect,
  onByokConnect,
  workspaceId,
  pendingOAuthSlug = null,
  oauthErrors = {},
  mode = "browse",
  initialCategory,
  suggestedSlugs = [],
  excludeSlug,
  onSwapSelect,
  swapCurrentName,
}: BrowseToolsModalProps) {
  void onByokConnect // reserved for future browse-time BYOK detection; see prop docstring
  const isSwap = mode === "swap"
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [apiKeyTool, setApiKeyTool] = useState<ToolDefinition | null>(null)
  const [localConnected, setLocalConnected] = useState<Set<string>>(new Set())
  const [remoteTools, setRemoteTools] = useState<ToolDefinition[] | null>(null)
  const [remoteCategories, setRemoteCategories] = useState<string[] | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [pendingNoAuthSlug, setPendingNoAuthSlug] = useState<string | null>(null)
  const [noAuthErrors, setNoAuthErrors] = useState<Record<string, string | undefined>>({})
  const listRef = useRef<HTMLDivElement>(null)

  const ROW_HEIGHT = 64
  const LIST_HEIGHT = 300
  const OVERSCAN = 6

  useEffect(() => {
    if (!open || !workspaceId) return
    // PR2.9 Task 7a: reset transient view state on every modal open.
    setSearch("")
    setActiveCategory(initialCategory && initialCategory.trim() ? initialCategory : "All")
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
  }, [open, workspaceId, initialCategory])

  const tools = remoteTools ?? ALL_TOOLS
  const categoryList = useMemo(() => remoteCategories ?? [...TOOL_CATEGORIES], [remoteCategories])
  const suggestedSet = useMemo(() => new Set(suggestedSlugs), [suggestedSlugs])

  const filtered = useMemo(() => {
    const base = tools.filter((tool) => {
      if (excludeSlug && tool.slug === excludeSlug) return false
      const matchesSearch =
        !search ||
        tool.name.toLowerCase().includes(search.toLowerCase()) ||
        tool.slug.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = activeCategory === "All" || tool.category === activeCategory
      return matchesSearch && matchesCategory
    })
    if (!isSwap || suggestedSet.size === 0) return base
    // Pin Suggested (alternatives[]) at top; preserve relative order within buckets.
    const suggested: ToolDefinition[] = []
    const rest: ToolDefinition[] = []
    for (const tool of base) {
      if (suggestedSet.has(tool.slug)) suggested.push(tool)
      else rest.push(tool)
    }
    // Order Suggested by alternatives[] order when possible.
    suggested.sort((a, b) => {
      const ia = suggestedSlugs.indexOf(a.slug)
      const ib = suggestedSlugs.indexOf(b.slug)
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    })
    return [...suggested, ...rest]
  }, [tools, search, activeCategory, excludeSlug, isSwap, suggestedSet, suggestedSlugs])

  const allConnected = useMemo(() => new Set([...connectedSlugs, ...localConnected]), [connectedSlugs, localConnected])

  function handleToolClick(tool: ToolDefinition) {
    if (isSwap) {
      onSwapSelect?.(tool)
      onClose()
      return
    }
    if (tool.slug === pendingOAuthSlug) return
    if (tool.authMode === "none") {
      void handleNoAuthAdd(tool)
      return
    }
    if (tool.connectionType === "API_KEY" && tool.credentialFields.length > 0) {
      setApiKeyTool(tool)
    } else if ((tool.connectionType === "OAUTH_COMPOSIO" || tool.connectionType === "NO_AUTH" || tool.credentialFields.length === 0) && composioOAuthAvailable) {
      onOAuthConnect(tool)
    }
  }

  async function handleNoAuthAdd(tool: ToolDefinition) {
    if (!workspaceId || pendingNoAuthSlug === tool.slug) return
    setPendingNoAuthSlug(tool.slug)
    setNoAuthErrors((prev) => ({ ...prev, [tool.slug]: undefined }))
    try {
      const res = await fetch(`/api/tools/${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolSlug: tool.slug,
          displayName: tool.name,
          connectionType: "NO_AUTH",
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setNoAuthErrors((prev) => ({ ...prev, [tool.slug]: data.error?.message || "Failed to add tool" }))
        return
      }
      setLocalConnected((prev) => new Set([...prev, tool.slug]))
      onConnect(tool)
    } catch {
      setNoAuthErrors((prev) => ({ ...prev, [tool.slug]: "Network error" }))
    } finally {
      setPendingNoAuthSlug((current) => current === tool.slug ? null : current)
    }
  }

  const categoryPills = useMemo(() => {
    const withAll = categoryList.includes("All") ? categoryList : ["All", ...categoryList]
    return withAll.map((cat) => ({ value: cat, label: formatCategory(cat) }))
  }, [categoryList])

  function formatCategory(raw: string): string {
    if (raw === "All") return raw
    return raw
      .split("_")
      .map((w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(" ")
  }

  const totalHeight = filtered.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(filtered.length, startIndex + visibleCount)
  const visibleTools = filtered.slice(startIndex, endIndex)
  const topSpacer = startIndex * ROW_HEIGHT
  const bottomSpacer = Math.max(0, totalHeight - topSpacer - visibleTools.length * ROW_HEIGHT)

  useEffect(() => {
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [search, activeCategory, tools])

  const modalTitle = isSwap
    ? `Swap${swapCurrentName ? `: ${swapCurrentName}` : ""}`
    : "Browse tools"
  const modalDescription = isSwap
    ? "Your agents adapt automatically via generated skill instructions."
    : browseLoading
      ? "Loading catalog…"
      : `Browse ${tools.length} tools. Curated list first; Composio catalog fills in when configured.`

  // Virtualization: when Suggested pins exist, render a non-virtualized Suggested
  // header by flattening — first suggested slug in visible window gets a label.
  const firstSuggestedSlug =
    isSwap && suggestedSlugs.length > 0
      ? filtered.find((t) => suggestedSet.has(t.slug))?.slug
      : undefined

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={modalTitle}
        description={modalDescription}
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
          <FilterPills
            options={categoryPills}
            value={activeCategory}
            onChange={setActiveCategory}
            className="mb-2.5"
          />
          <div
            ref={listRef}
            className="border border-[var(--bd)] rounded-xl overflow-hidden overflow-y-auto"
            style={{ maxHeight: LIST_HEIGHT }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            data-testid={isSwap ? "browse-tools-swap" : "browse-tools"}
          >
            {browseLoading && (
              <div className="px-3.5 py-3">
                <LoadingSkeleton variant="card" count={4} />
              </div>
            )}
            {!browseLoading && filtered.length === 0 && (
              <div className="px-3.5 py-6 text-center text-xs text-[var(--tx3)]">No tools found.</div>
            )}
            {!browseLoading &&
              <>
                {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden="true" />}
                {visibleTools.map((tool) => {
                const isConnected = allConnected.has(tool.slug)
                const isPendingOAuth = pendingOAuthSlug === tool.slug
                const isPendingNoAuth = pendingNoAuthSlug === tool.slug
                const oauthError = oauthErrors[tool.slug]
                const noAuthError = noAuthErrors[tool.slug]
                const brokeredByComposio = tool.connectionType === "OAUTH_COMPOSIO" || tool.connectionType === "NO_AUTH" || tool.credentialFields.length === 0
                const customOauthBlocked = tool.authMode === "custom-oauth-required"
                const comingSoonReason = tool.comingSoonReason ?? "Requires a Claws-owned OAuth app before connection is available."
                const isSuggested = isSwap && suggestedSet.has(tool.slug)
                const showSuggestedLabel = isSuggested && tool.slug === firstSuggestedSlug && startIndex === 0
                return (
                  <div key={tool.slug}>
                    {showSuggestedLabel && (
                      <div
                        className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]"
                        data-testid="swap-suggested-label"
                      >
                        Suggested
                      </div>
                    )}
                    <div
                      className="flex items-center gap-3 px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0"
                      style={{ minHeight: ROW_HEIGHT }}
                      data-suggested={isSuggested ? "true" : undefined}
                    >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <StatusDot status={isConnected ? "connected" : "disconnected"} />
                      <div className="min-w-0">
                        <div className="min-w-0 text-xs font-semibold">
                          <TruncatedText>{tool.name}</TruncatedText>
                        </div>
                        <div className="min-w-0 text-[10px] text-[var(--tx2)]">
                          <TruncatedText>{tool.description || tool.category}</TruncatedText>
                        </div>
                        {oauthError && (
                          <div className="text-[10px] text-[var(--err)] mt-0.5">{oauthError}</div>
                        )}
                        {noAuthError && (
                          <div className="text-[10px] text-[var(--err)] mt-0.5">{noAuthError}</div>
                        )}
                      </div>
                    </div>
                    {isSwap ? (
                      <Button
                        type="button"
                        onClick={() => handleToolClick(tool)}
                        size="sm"
                        className="shrink-0"
                        disabled={customOauthBlocked}
                      >
                        Select
                      </Button>
                    ) : isConnected ? (
                      <span className="text-[10px] text-[var(--ok)] font-medium shrink-0">Connected</span>
                    ) : customOauthBlocked ? (
                      <Badge variant="warning" title={comingSoonReason} className="shrink-0">
                        Coming Soon
                      </Badge>
                    ) : tool.authMode === "none" ? (
                      <Button
                        type="button"
                        onClick={() => handleToolClick(tool)}
                        size="sm"
                        loading={isPendingNoAuth}
                        disabled={isPendingNoAuth}
                        className="shrink-0"
                      >
                        Add
                      </Button>
                    ) : brokeredByComposio ? (
                      composioOAuthAvailable ? (
                        <Button
                          type="button"
                          onClick={() => handleToolClick(tool)}
                          size="sm"
                          loading={isPendingOAuth}
                          disabled={isPendingOAuth}
                          className="shrink-0"
                        >
                          {tool.authMode === "byok-api-key" ? "Enter API key" : "Connect with OAuth"}
                        </Button>
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
                        Enter API key
                      </button>
                    )}
                    </div>
                  </div>
                )
              })}
              {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}
            </>}
          </div>
        </div>
      </Modal>

      {apiKeyTool && !isSwap && (
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
