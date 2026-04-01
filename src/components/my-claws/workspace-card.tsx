"use client"

import { useRouter } from "next/navigation"
import { StatusBadge } from "@/components/ui/status-badge"
import { WorkspaceContextMenu } from "./workspace-context-menu"

type WorkspaceStatus = "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped"

interface WorkspaceCardProps {
  id: string
  name: string
  status: WorkspaceStatus
  apiStatus: string
  agentCount: number
  agentRoles: string[]
  lastActive?: string
  monthlyCost?: string
  source: string
  isCreatorEnrolled: boolean
  onRename: (id: string, currentName: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string, name: string) => void
}

export function WorkspaceCard({
  id, name, status, apiStatus, agentCount, agentRoles, lastActive, monthlyCost, source,
  isCreatorEnrolled, onRename, onDuplicate, onDelete,
}: WorkspaceCardProps) {
  const router = useRouter()

  const handleClick = () => {
    if (status === "running" || status === "paused") router.push(`/dashboard/${id}`)
    else if (status === "draft") router.push(`/builder/${id}`)
    else if (status === "setup") router.push(`/setup/${id}/step/1`)
    else router.push(`/dashboard/${id}`)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick() } }}
      className="group relative border border-[var(--bd)] rounded-xl p-3.5 cursor-pointer transition-colors hover:border-[var(--bd2)]"
    >
      <div className="flex justify-between items-start mb-1.5">
        <h3 className="text-sm font-semibold pr-6">{name}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="text-[11px] text-[var(--tx2)]">{agentCount} agents · {source}</p>
      <div className="flex gap-3.5 mt-1 text-[11px] text-[var(--tx2)]">
        {lastActive && <span>Last: {lastActive}</span>}
        {monthlyCost && <span>{monthlyCost} this month</span>}
      </div>

      <div className="absolute top-[8px] right-[8px]">
        <WorkspaceContextMenu
          workspaceId={id}
          workspaceName={name}
          status={apiStatus}
          agentRoles={agentRoles}
          isCreatorEnrolled={isCreatorEnrolled}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
