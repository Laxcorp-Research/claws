"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { Modal } from "@/components/ui/modal"
import { DriftBanner } from "@/components/shared/drift-banner"
import { AgentCanvas } from "@/components/builder/agent-canvas"
import { AgentSidebar } from "@/components/builder/agent-sidebar"
import { PropertiesPanel } from "@/components/builder/properties-panel"
import { HeartbeatConfig } from "@/components/builder/heartbeat-config"
import { VersionHistoryPanel } from "@/components/builder/version-history-panel"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { NetworkError } from "@/components/shared/network-error"
import { useBuilderStore } from "@/stores/builder-store"
import { Loader2, Send, Save, Check, AlertTriangle } from "lucide-react"
import { RedeployProgressModal } from "@/components/dashboard/redeploy-progress-modal"
import { useWorkspaceRedeploy } from "@/components/dashboard/use-workspace-redeploy"

interface ConfigDriftInfo {
  isStale: boolean
  changedAreas: string[]
}

export default function BuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { loadWorkspace, workspaceName, workspaceStatus, isDirty, isSaving, isLoading, loadError, lastSavedAt, saveWorkspace, revertToLastSaved, hasDraftRecovery, draftTimestamp, restoreDraft, dismissDraft } = useBuilderStore()
  const [showHistory, setShowHistory] = useState(false)
  const [localName, setLocalName] = useState("")
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [configDrift, setConfigDrift] = useState<ConfigDriftInfo | null>(null)
  const [driftWorkspaceStatus, setDriftWorkspaceStatus] = useState<string | null>(null)

  const fetchConfigDrift = useCallback(async () => {
    try {
      const res = await fetch(`/api/deploy/${workspaceId}/status?drift=1`)
      const json = await res.json()
      if (!json.success) return
      setDriftWorkspaceStatus(json.data?.workspaceStatus ?? null)
      if (json.data?.drift) {
        setConfigDrift({
          isStale: Boolean(json.data.drift.isStale),
          changedAreas: Array.isArray(json.data.drift.changedAreas) ? json.data.drift.changedAreas : [],
        })
      }
    } catch {
      // Advisory only; dashboard/setup surfaces remain the backstop.
    }
  }, [workspaceId])

  const redeployFlow = useWorkspaceRedeploy({
    workspaceId,
    onCompleted: () => {
      void fetchConfigDrift()
    },
  })

  useEffect(() => {
    loadWorkspace(workspaceId)
    void fetchConfigDrift()
  }, [workspaceId, loadWorkspace, fetchConfigDrift])

  useEffect(() => {
    if (loadError === 401) router.push("/auth/signin")
    else if (loadError === 403 || loadError === 404) router.replace("/my-claws")
  }, [loadError, router])

  // Batch D: 5xx / network - distinct NetworkError + Retry (not empty canvas).
  const isLoadNetworkError =
    loadError !== null && loadError !== 401 && loadError !== 403 && loadError !== 404

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
    void fetchConfigDrift()
  }, [saveWorkspace, fetchConfigDrift])

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

  const showConfigDrift = configDrift?.isStale === true && (driftWorkspaceStatus === "RUNNING" || driftWorkspaceStatus === "PAUSED" || workspaceStatus === "RUNNING" || workspaceStatus === "PAUSED")

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)]">
      {/* Builder top bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bd)] bg-[var(--bg)]">
        <div className="flex items-center gap-[10px] min-w-0">
          <button onClick={handleBack} className="text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] cursor-pointer bg-transparent border-none flex-shrink-0 transition-colors">
            ← My Claws
          </button>
          <h1 className="sr-only">{localName || "Builder"}</h1>
          <input
            type="text"
            aria-label="Workspace name"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
            className="text-[14px] font-semibold bg-transparent border border-transparent hover:border-[var(--bd)] focus:border-[var(--tx)] rounded-[6px] px-2 py-[3px] outline-none text-[var(--tx)] min-w-0"
          />
          <StatusBadge status={workspaceStatus === "RUNNING" ? "running" : workspaceStatus === "DRAFT" ? "draft" : "setup"} />
        </div>

        <div className="flex items-center gap-[6px] flex-shrink-0">
          <Button variant="ghost" size="sm" className="text-[10px]" onClick={() => setShowHistory(!showHistory)}>
            History
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/setup/${workspaceId}/step/2?from=builder&mode=manage`)}>
            Manage Tools
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/dashboard/${workspaceId}`)}>
            Dashboard
          </Button>
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/publish/template?workspaceId=${workspaceId}`)}>
            <Send size={10} className="mr-1" aria-hidden="true" /> Publish
          </Button>
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
          <Button variant="primary" size="sm" className="text-[10px]" onClick={() => handleNavigate(`/setup/${workspaceId}/step/1?from=builder`)}>
            Deploy
          </Button>
        </div>
      </div>

      {showConfigDrift && configDrift && (
        <div className="px-3 pt-2">
          <DriftBanner
            changedAreas={configDrift.changedAreas}
            actions={
              <Button variant="outline" size="sm" onClick={() => void redeployFlow.startRedeploy()}>
                Redeploy
              </Button>
            }
          />
        </div>
      )}

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
              className="px-[10px] py-[4px] text-[11px] text-white bg-[var(--caution)] rounded-[4px] hover:opacity-90 cursor-pointer border-none"
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
      ) : isLoadNetworkError ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <NetworkError
            message="Failed to load the builder. Check your connection and try again."
            onRetry={() => {
              void loadWorkspace(workspaceId)
            }}
          />
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-[220px_1fr_260px] gap-2.5 p-2.5 min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-2.5">
            <div
              data-testid="builder-agents-pane"
              className="min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <AgentSidebar />
            </div>
            <div
              data-testid="builder-heartbeat-pane"
              className="min-h-0 min-w-0 max-h-[65%] overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--bd)] p-2.5"
            >
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
      <RedeployProgressModal
        open={redeployFlow.modalOpen}
        redeploying={redeployFlow.redeploying}
        status={redeployFlow.status}
        lastStage={redeployFlow.lastStage}
        error={redeployFlow.error}
        onClose={redeployFlow.closeModal}
        onRetry={redeployFlow.retry}
      />
    </div>
  )
}
