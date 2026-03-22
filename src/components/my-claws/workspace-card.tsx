"use client"

import { useRouter } from "next/navigation"
import { StatusBadge } from "@/components/ui/status-badge"

type WorkspaceStatus = "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped"

interface WorkspaceCardProps {
  id: string
  name: string
  status: WorkspaceStatus
  agentCount: number
  lastActive?: string
  monthlyCost?: string
  source: string
}

export function WorkspaceCard({ id, name, status, agentCount, lastActive, monthlyCost, source }: WorkspaceCardProps) {
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
      className="border border-[var(--bd)] rounded-xl p-3.5 cursor-pointer transition-colors hover:border-[var(--bd2)]"
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
    </div>
  )
}
