"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  MoreHorizontal,
  PenLine,
  Copy,
  Rocket,
  LayoutDashboard,
  Upload,
  Square,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

interface WorkspaceContextMenuProps {
  workspaceId: string
  workspaceName: string
  status: string
  agentRoles: string[]
  isCreatorEnrolled: boolean
  onRename: (id: string, currentName: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string, name: string) => void
}

export function WorkspaceContextMenu({
  workspaceId,
  workspaceName,
  status,
  agentRoles,
  isCreatorEnrolled,
  onRename,
  onDuplicate,
  onDelete,
}: WorkspaceContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const snackbar = useSnackbarOptional()

  async function handleStop() {
    setStopping(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/deploy/${workspaceId}/stop`, { method: "POST" })
          if (!res.ok) throw new Error("Could not stop Claw")
          router.refresh()
        },
        { message: "Claw stopped", errorMessage: "Could not stop Claw" },
        (opts) => snackbar?.show(opts),
      )
    } catch {
      /* error snackbar already shown */
    } finally {
      setStopping(false)
      setStopConfirmOpen(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [isOpen])

  const isRunning = status === "RUNNING"
  const isPaused = status === "PAUSED"
  const isStopped = status === "STOPPED"
  const isDraft = status === "DRAFT"
  const isSetup = status === "SETUP_INCOMPLETE"
  const hasDeployment = isRunning || isPaused || isStopped || status === "ERROR"

  const hasOrch = agentRoles.includes("ORCHESTRATOR")
  const hasCritic = agentRoles.includes("CRITIC")
  const hasWorker = agentRoles.includes("WORKER")
  const isPublishReady = hasOrch && hasCritic && hasWorker && agentRoles.length >= 3

  function act(fn: () => void) {
    setIsOpen(false)
    fn()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(!isOpen) }}
        className="p-[6px] rounded-[6px] hover:bg-[var(--bg2)] transition-colors cursor-pointer border-none bg-transparent"
        aria-label="Workspace options"
      >
        <MoreHorizontal className="w-[16px] h-[16px] text-[var(--tx3)]" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+4px)] w-[200px] bg-[var(--bg)] border border-[var(--bd)] rounded-[8px] shadow-modal py-[4px] z-50" role="menu">
          <Item icon={PenLine} label="Open in Builder" onClick={() => act(() => router.push(`/builder/${workspaceId}`))} />
          {hasDeployment && (
            <Item icon={LayoutDashboard} label="Open Dashboard" onClick={() => act(() => router.push(`/dashboard/${workspaceId}`))} />
          )}
          {(isDraft || isSetup) && (
            <Item icon={Rocket} label={isSetup ? "Continue Setup" : "Setup & Deploy"} onClick={() => act(() => router.push(`/setup/${workspaceId}/step/1`))} />
          )}

          <Divider />
          <Item icon={PenLine} label="Rename" onClick={() => act(() => onRename(workspaceId, workspaceName))} />
          <Item icon={Copy} label="Duplicate" onClick={() => act(() => onDuplicate(workspaceId))} />

          <Divider />
          {isCreatorEnrolled ? (
            isPublishReady ? (
              <Item icon={Upload} label="Publish as Template" onClick={() => act(() => router.push(`/publish/template?workspaceId=${workspaceId}`))} />
            ) : (
              <Item icon={Upload} label="Publish as Template" disabled hint="Need Orchestrator + Worker + Critic" onClick={() => {}} />
            )
          ) : (
            <Item icon={Upload} label="Become a Creator" hint="Publish templates on the marketplace" onClick={() => act(() => router.push("/settings?tab=creator"))} />
          )}

          {isRunning && (
            <>
              <Divider />
              <Item icon={Square} label="Stop" onClick={() => act(() => setStopConfirmOpen(true))} />
            </>
          )}
          {isStopped && (
            <>
              <Divider />
              <Item
                icon={RotateCcw}
                label="Redeploy"
                onClick={() => act(() => router.push(`/dashboard/${workspaceId}`))}
              />
            </>
          )}

          <Divider />
          <Item icon={Trash2} label="Delete" danger onClick={() => act(() => onDelete(workspaceId, workspaceName))} />
        </div>
      )}

      <ConfirmDialog
        open={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        onConfirm={handleStop}
        title="Stop this Claw?"
        description="Agents will stop running. Your configuration and history are saved — redeploying takes about 2 minutes."
        confirmLabel="Stop"
        cancelLabel="Keep running"
        loading={stopping}
      />
    </div>
  )
}

function Item({ icon: Icon, label, onClick, danger, disabled, hint }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!disabled) onClick() }}
      disabled={disabled}
      role="menuitem"
      className={`w-full text-left px-[12px] py-[6px] text-[12px] flex items-center gap-[8px] transition-colors border-none bg-transparent cursor-pointer ${
        disabled ? "opacity-40 cursor-not-allowed text-[var(--tx3)]"
          : danger ? "text-[var(--err)] hover:bg-[var(--errbg)]"
          : "text-[var(--tx2)] hover:bg-[var(--bg2)]"
      }`}
    >
      <Icon className="w-[14px] h-[14px] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span>{label}</span>
        {hint && <div className="text-[10px] text-[var(--tx3)] mt-[1px] leading-tight">{hint}</div>}
      </div>
    </button>
  )
}

function Divider() {
  return <div className="border-t border-[var(--bd)] my-[4px]" />
}
