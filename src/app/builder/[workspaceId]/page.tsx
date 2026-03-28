"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { AgentCanvas } from "@/components/builder/agent-canvas"
import { AgentSidebar } from "@/components/builder/agent-sidebar"
import { PropertiesPanel } from "@/components/builder/properties-panel"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { VersionHistoryPanel } from "@/components/builder/version-history-panel"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { useBuilderStore } from "@/stores/builder-store"
import { Loader2, Send } from "lucide-react"

export default function BuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { loadWorkspace, workspaceName, workspaceStatus, isDirty, isSaving, isLoading } = useBuilderStore()
  const [showHistory, setShowHistory] = useState(false)
  const [localName, setLocalName] = useState(workspaceName)

  useEffect(() => {
    loadWorkspace(workspaceId)
  }, [workspaceId, loadWorkspace])

  useEffect(() => {
    setLocalName(workspaceName)
  }, [workspaceName])

  const handleNameSave = async () => {
    if (localName === workspaceName || !localName.trim()) return
    useBuilderStore.getState().setWorkspaceName(localName.trim())
    try {
      await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: localName.trim() }),
      })
    } catch (err) {
      console.error("Failed to save workspace name:", err)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      {/* Builder top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bd)] bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <h1 className="sr-only">{localName || "Builder"}</h1>
          <input
            type="text"
            aria-label="Workspace name"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
            className="text-sm font-semibold bg-transparent border border-transparent hover:border-[var(--bd)] focus:border-[var(--tx)] rounded-[6px] px-2 py-[3px] outline-none text-[var(--tx)] w-[200px]"
          />
          <StatusBadge status={workspaceStatus === "RUNNING" ? "running" : workspaceStatus === "DRAFT" ? "draft" : "setup"} />
          {isSaving && <span className="text-[10px] text-[var(--tx3)]">Saving...</span>}
          {!isSaving && isDirty && <span className="text-[10px] text-[var(--tx3)]">Unsaved changes</span>}
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="text-[10px]" onClick={() => setShowHistory(!showHistory)}>
            History
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => router.push(`/setup/${workspaceId}/step/2`)}>
            Manage Tools
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => router.push(`/dashboard/${workspaceId}`)}>
            Dashboard
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => router.push(`/publish/template?workspaceId=${workspaceId}`)}>
            <Send size={10} className="mr-1" aria-hidden="true" /> Publish
          </Button>
          <Button variant="primary" size="sm" className="text-[10px]" onClick={() => router.push(`/setup/${workspaceId}/step/3`)}>
            Deploy
          </Button>
        </div>
      </div>

      {/* 3-panel grid */}
      {isLoading ? (
        <div className="flex-1 grid grid-cols-[190px_1fr_190px] gap-2.5 p-2.5 min-h-0 overflow-hidden">
          <div className="border border-[var(--bd)] rounded-lg p-2.5 space-y-2">
            <LoadingSkeleton variant="short" />
            <LoadingSkeleton variant="line" />
            <LoadingSkeleton variant="line" />
            <LoadingSkeleton variant="line" />
          </div>
          <div className="relative bg-[var(--bg2)] border border-dashed border-[var(--bd)] rounded-lg flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[var(--tx3)] animate-spin" role="status" aria-label="Loading" />
          </div>
          <div className="border border-[var(--bd)] rounded-lg p-2.5 space-y-2">
            <LoadingSkeleton variant="short" />
            <LoadingSkeleton variant="line" />
            <LoadingSkeleton variant="line" />
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[190px_1fr_190px] gap-2.5 p-2.5 min-h-0 overflow-hidden">
          <AgentSidebar />
          <div className="relative bg-[var(--bg2)] border border-dashed border-[var(--bd)] rounded-lg overflow-hidden">
            <AgentCanvas />
            <HeartbeatConfig />
            <VersionHistoryPanel open={showHistory} onClose={() => setShowHistory(false)} />
          </div>
          <PropertiesPanel />
        </div>
      )}
    </div>
  )
}
