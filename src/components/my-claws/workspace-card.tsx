"use client"

import { useRouter } from "next/navigation"
import { StatusBadge } from "@/components/ui/status-badge"
import { Trash2 } from "lucide-react"

type WorkspaceStatus = "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped"

interface WorkspaceCardProps {
  id: string
  name: string
  status: WorkspaceStatus
  agentCount: number
  lastActive?: string
  monthlyCost?: string
  source: string
  onDelete?: (id: string, name: string) => void
}

export function WorkspaceCard({ id, name, status, agentCount, lastActive, monthlyCost, source, onDelete }: WorkspaceCardProps) {
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
        <h3 className="text-sm font-semibold">{name}</h3>
        <StatusBadge status={status} />
      </div>
      <p className="text-[11px] text-[var(--tx2)]">{agentCount} agents · {source}</p>
      <div className="flex gap-3.5 mt-1 text-[11px] text-[var(--tx2)]">
        {lastActive && <span>Last: {lastActive}</span>}
        {monthlyCost && <span>{monthlyCost} this month</span>}
      </div>

      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(id, name) }}
          className="absolute top-[10px] right-[10px] p-[6px] rounded-[6px] opacity-0 group-hover:opacity-100 hover:bg-[var(--errbg)] transition-all cursor-pointer border-none bg-transparent"
          aria-label={`Delete ${name}`}
          title="Delete"
        >
          <Trash2 className="w-[14px] h-[14px] text-[var(--tx3)] hover:text-[var(--err)]" />
        </button>
      )}
    </div>
  )
}
