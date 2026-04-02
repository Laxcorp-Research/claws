"use client"

import { useState, useMemo } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusDot } from "@/components/ui/status-dot"
import { ApiKeyModal } from "./api-key-modal"
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDefinition } from "@/data/tool-catalog"

interface BrowseToolsModalProps {
  open: boolean
  onClose: () => void
  connectedSlugs: string[]
  onConnect: (tool: ToolDefinition) => void
  workspaceId?: string
}

export function BrowseToolsModal({ open, onClose, connectedSlugs, onConnect, workspaceId }: BrowseToolsModalProps) {
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [apiKeyTool, setApiKeyTool] = useState<ToolDefinition | null>(null)
  const [localConnected, setLocalConnected] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    return ALL_TOOLS.filter((tool) => {
      const matchesSearch = !search || tool.name.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = activeCategory === "All" || tool.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [search, activeCategory])

  const allConnected = useMemo(() => new Set([...connectedSlugs, ...localConnected]), [connectedSlugs, localConnected])

  function handleToolClick(tool: ToolDefinition) {
    if (tool.connectionType === "API_KEY") {
      setApiKeyTool(tool)
    } else {
      onConnect(tool)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Browse tools"
        description={`Browse ${ALL_TOOLS.length} available tools. More integrations coming soon.`}
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-[var(--tx3)]">{filtered.length} tools</span>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        }
      >
        <div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools..." className="mb-2.5" />
          <div className="flex gap-1.5 flex-wrap mb-2.5">
            {TOOL_CATEGORIES.filter((_, i) => i < 10).map((cat) => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={`text-[10px] px-2 py-[3px] rounded-md border transition-colors cursor-pointer bg-transparent ${activeCategory === cat ? "bg-[var(--tx)] text-white border-[var(--tx)]" : "border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)]"}`}>
                {cat}
              </button>
            ))}
          </div>
          <div className="border border-[var(--bd)] rounded-xl overflow-hidden max-h-[300px] overflow-y-auto">
            {filtered.length === 0 && <div className="px-3.5 py-6 text-center text-xs text-[var(--tx3)]">No tools found.</div>}
            {filtered.map((tool) => {
              const isConnected = allConnected.has(tool.slug)
              return (
                <div key={tool.slug} className="flex items-center justify-between px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0">
                  <div className="flex items-center gap-2">
                    <StatusDot status={isConnected ? "connected" : "disconnected"} />
                    <div>
                      <div className="text-xs font-semibold">{tool.name}</div>
                      <div className="text-[10px] text-[var(--tx2)]">{tool.description || tool.category}</div>
                    </div>
                  </div>
                  {isConnected ? (
                    <span className="text-[10px] text-[var(--ok)] font-medium">Connected</span>
                  ) : tool.connectionType === "OAUTH_COMPOSIO" ? (
                    <span className="text-[10px] text-[var(--tx3)] px-[8px] py-[3px] border border-[var(--bd)] rounded-[4px]">
                      OAuth — Coming soon
                    </span>
                  ) : (
                    <button onClick={() => handleToolClick(tool)} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity cursor-pointer border-none">Connect</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Modal>

      {apiKeyTool && (
        <ApiKeyModal
          open={true}
          onClose={() => setApiKeyTool(null)}
          toolName={apiKeyTool.name}
          helpUrl={apiKeyTool.helpUrl}
          keyPlaceholder={apiKeyTool.keyPlaceholder}
          onSave={async (apiKey) => {
            if (!workspaceId) return { success: false, error: "No workspace" }
            try {
              const res = await fetch(`/api/tools/${workspaceId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toolSlug: apiKeyTool.slug, displayName: apiKeyTool.name, connectionType: "API_KEY", apiKey }),
              })
              const data = await res.json()
              if (data.success) {
                setLocalConnected(prev => new Set([...prev, apiKeyTool.slug]))
                onConnect(apiKeyTool)
                setApiKeyTool(null)
                return { success: true }
              }
              return { success: false, error: data.error?.message || "Failed to connect" }
            } catch { return { success: false, error: "Network error" } }
          }}
        />
      )}
    </>
  )
}
