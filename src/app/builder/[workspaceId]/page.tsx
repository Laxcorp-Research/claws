"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { Modal } from "@/components/ui/modal"
import { AgentCanvas } from "@/components/builder/agent-canvas"
import { AgentSidebar } from "@/components/builder/agent-sidebar"
import { PropertiesPanel } from "@/components/builder/properties-panel"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { VersionHistoryPanel } from "@/components/builder/version-history-panel"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { useBuilderStore } from "@/stores/builder-store"
import { Loader2, Send, Save, Check, ArrowLeft, AlertTriangle } from "lucide-react"

export default function BuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { loadWorkspace, workspaceName, workspaceStatus, isDirty, isSaving, isLoading, lastSavedAt, saveWorkspace, revertToLastSaved, hasDraftRecovery, draftTimestamp, restoreDraft, dismissDraft } = useBuilderStore()
  const [showHistory, setShowHistory] = useState(false)
  const [localName, setLocalName] = useState("")
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)

  useEffect(() => {
    loadWorkspace(workspaceId)
  }, [workspaceId, loadWorkspace])

  useEffect(() => {
    setLocalName(workspaceName)
  }, [workspaceName])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useBuilderStore.getState().isDirty) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

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

  const handleSave = useCallback(async () => {
    await saveWorkspace()
    setHistoryRefreshKey(prev => prev + 1)
  }, [saveWorkspace])

  function handleNavigate(path: string) {
    if (useBuilderStore.getState().isDirty) {
      setPendingNavigation(path)
      setShowUnsavedDialog(true)
    } else {
      router.push(path)
    }
  }

  function handleBack() {
    handleNavigate("/my-claws")
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
        </div>
        <div className="flex items-center gap-[6px]">
          {isSaving ? (
            <Button size="sm" variant="outline" disabled className="text-[10px]">
              <Loader2 className="w-[14px] h-[14px] animate-spin mr-[4px]" />
              Saving...
            </Button>
          ) : isDirty ? (
            <Button size="sm" variant="primary" onClick={handleSave} className="text-[10px]">
              <Save className="w-[14px] h-[14px] mr-[4px]" />
              Save
            </Button>
          ) : lastSavedAt ? (
            <Button size="sm" variant="outline" disabled className="text-[10px] opacity-50">
              <Check className="w-[14px] h-[14px] mr-[4px]" />
              Saved
            </Button>
          ) : null}
          <button onClick={handleBack} className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] flex items-center gap-1 transition-colors cursor-pointer bg-transparent border-none">
            <ArrowLeft size={12} />
            My Claws
          </button>
          <Button variant="ghost" size="sm" className="text-[10px]" onClick={() => setShowHistory(!showHistory)}>
            History
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/setup/${workspaceId}/step/2?from=builder`)}>
            Manage Tools
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/dashboard/${workspaceId}`)}>
            Dashboard
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/publish/template?workspaceId=${workspaceId}`)}>
            <Send size={10} className="mr-1" aria-hidden="true" /> Publish
          </Button>
          <Button variant="primary" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/setup/${workspaceId}/step/1`)}>
            Deploy
          </Button>
        </div>
      </div>

      {hasDraftRecovery && (
        <div className="bg-[var(--warnbg)] border-b border-[var(--warn)] px-[14px] py-[8px] flex items-center justify-between">
          <div className="flex items-center gap-[8px]">
            <AlertTriangle className="w-[14px] h-[14px] text-[var(--warn)] flex-shrink-0" />
            <span className="text-[12px] text-[#92400e]">
              You have unsaved changes from {draftTimestamp ? new Date(draftTimestamp).toLocaleString() : "a previous session"}.
            </span>
          </div>
          <div className="flex items-center gap-[6px]">
            <button
              onClick={dismissDraft}
              className="px-[10px] py-[4px] text-[11px] text-[var(--tx2)] border border-[var(--bd)] rounded-[4px] hover:bg-[var(--bg2)] cursor-pointer bg-transparent"
            >
              Discard
            </button>
            <button
              onClick={restoreDraft}
              className="px-[10px] py-[4px] text-[11px] text-white bg-[var(--warn)] rounded-[4px] hover:opacity-90 cursor-pointer border-none"
            >
              Restore changes
            </button>
          </div>
        </div>
      )}

      {/* 3-panel grid */}
      {isLoading ? (
        <div className="flex-1 grid grid-cols-[220px_1fr_260px] gap-2.5 p-2.5 min-h-0 overflow-hidden">
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
        <div className="flex-1 grid grid-cols-[220px_1fr_260px] gap-2.5 p-2.5 min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2.5 min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">
              <AgentSidebar />
            </div>
            <div className="border border-[var(--bd)] rounded-lg p-2.5 flex-shrink-0">
              <HeartbeatConfig />
            </div>
          </div>
          <div className="relative bg-[var(--bg2)] border border-dashed border-[var(--bd)] rounded-lg overflow-hidden">
            <AgentCanvas />
            <VersionHistoryPanel open={showHistory} onClose={() => setShowHistory(false)} refreshKey={historyRefreshKey} />
          </div>
          <PropertiesPanel />
        </div>
      )}

      {/* Unsaved changes dialog */}
      <Modal
        open={showUnsavedDialog}
        onClose={() => setShowUnsavedDialog(false)}
        title="Unsaved changes"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                revertToLastSaved()
                setShowUnsavedDialog(false)
                if (pendingNavigation) router.push(pendingNavigation)
              }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={isSaving}
              onClick={async () => {
                await handleSave()
                setShowUnsavedDialog(false)
                if (pendingNavigation) router.push(pendingNavigation)
              }}
            >
              Save & leave
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--tx2)]">
          You have unsaved changes. Do you want to save before leaving?
        </p>
      </Modal>
    </div>
  )
}
