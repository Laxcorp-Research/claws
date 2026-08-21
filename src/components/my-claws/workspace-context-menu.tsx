"use client"

import { useState, type ComponentType } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  /** Batch B: patch local list from stop response (reload-consistency). */
  onStopped?: (id: string, status: string) => void
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
  onStopped,
}: WorkspaceContextMenuProps) {
  const [open, setOpen] = useState(false)
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const router = useRouter()
  const snackbar = useSnackbarOptional()

  async function handleStop() {
    setStopping(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/deploy/${workspaceId}/stop`, { method: "POST" })
          const json = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(json?.error?.message || "Could not stop Claw")
          const nextStatus =
            typeof json?.data?.status === "string" ? json.data.status : "STOPPED"
          onStopped?.(workspaceId, nextStatus)
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
    setOpen(false)
    fn()
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
            }}
            className="p-[6px] rounded-[6px] hover:bg-[var(--bg2)] transition-colors cursor-pointer border-none bg-transparent"
            aria-label="Workspace options"
          >
            <MoreHorizontal className="w-[16px] h-[16px] text-[var(--tx3)]" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="w-[200px]"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <MenuItem
            icon={PenLine}
            label="Open in Builder"
            onSelect={() => act(() => router.push(`/builder/${workspaceId}`))}
          />
          {hasDeployment && (
            <MenuItem
              icon={LayoutDashboard}
              label="Open Dashboard"
              onSelect={() => act(() => router.push(`/dashboard/${workspaceId}`))}
            />
          )}
          {(isDraft || isSetup) && (
            <MenuItem
              icon={Rocket}
              label={isSetup ? "Continue Setup" : "Setup & Deploy"}
              onSelect={() => act(() => router.push(`/setup/${workspaceId}/step/1`))}
            />
          )}

          <DropdownMenuSeparator />
          <MenuItem
            icon={PenLine}
            label="Rename"
            onSelect={() => act(() => onRename(workspaceId, workspaceName))}
          />
          <MenuItem
            icon={Copy}
            label="Duplicate"
            onSelect={() => act(() => onDuplicate(workspaceId))}
          />

          <DropdownMenuSeparator />
          {isCreatorEnrolled ? (
            isPublishReady ? (
              <MenuItem
                icon={Upload}
                label="Publish as Template"
                onSelect={() => act(() => router.push(`/publish/template?workspaceId=${workspaceId}`))}
              />
            ) : (
              <MenuItem
                icon={Upload}
                label="Publish as Template"
                disabled
                hint="Need Orchestrator + Worker + Critic"
                onSelect={() => {}}
              />
            )
          ) : (
            <MenuItem
              icon={Upload}
              label="Become a Creator"
              hint="Publish templates on the marketplace"
              onSelect={() => act(() => router.push("/settings?tab=creator"))}
            />
          )}

          {isRunning && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                icon={Square}
                label="Stop"
                onSelect={() => act(() => setStopConfirmOpen(true))}
              />
            </>
          )}
          {isStopped && (
            <>
              <DropdownMenuSeparator />
              <MenuItem
                icon={RotateCcw}
                label="Open to redeploy"
                onSelect={() => act(() => router.push(`/dashboard/${workspaceId}`))}
              />
            </>
          )}

          <DropdownMenuSeparator />
          <MenuItem
            icon={Trash2}
            label="Delete"
            danger
            onSelect={() => act(() => onDelete(workspaceId, workspaceName))}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        onConfirm={handleStop}
        title="Stop this Claw?"
        description="Agents will stop running. Your configuration and history are saved - redeploying takes about 2 minutes."
        confirmLabel="Stop"
        cancelLabel="Keep running"
        loading={stopping}
      />
    </>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      danger={danger}
      onSelect={(e) => {
        e.preventDefault()
        if (!disabled) onSelect()
      }}
      className={hint ? "items-start" : undefined}
    >
      <Icon className="w-[14px] h-[14px] flex-shrink-0 mt-[1px]" />
      <div className="flex-1 min-w-0">
        <span>{label}</span>
        {hint && <div className="text-[10px] text-[var(--tx3)] mt-[1px] leading-tight">{hint}</div>}
      </div>
    </DropdownMenuItem>
  )
}
