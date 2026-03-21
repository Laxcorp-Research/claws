"use client"

import { useState } from "react"
import { PendingApprovalCard } from "./pending-approval-card"

interface PendingApproval {
  id: string
  title: string
  description: string
  agentName: string
  agentColor: string
  timestamp: string
}

interface PendingApprovalsProps {
  workspaceId: string
  approvals: PendingApproval[]
  onApprove: (id: string) => Promise<void>
  onReject: (id: string, feedback?: string) => Promise<void>
}

export function PendingApprovals({ approvals, onApprove, onReject }: PendingApprovalsProps) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  if (approvals.length === 0) return null

  const handleApprove = async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id))
    try {
      await onApprove(id)
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  const handleReject = async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id))
    try {
      await onReject(id)
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  return (
    <div className="border border-[var(--warn)] rounded-lg p-3 bg-[var(--warnbg)] mb-[14px]">
      <h4 className="text-[11px] font-semibold text-[#92400e] mb-1.5">
        Pending your approval ({approvals.length} {approvals.length === 1 ? "item" : "items"})
      </h4>
      <div className="flex flex-col gap-1.5">
        {approvals.map((a) => (
          <PendingApprovalCard
            key={a.id}
            id={a.id}
            title={a.title}
            description={a.description}
            agentName={a.agentName}
            agentColor={a.agentColor}
            timestamp={a.timestamp}
            onApprove={handleApprove}
            onReject={handleReject}
            isLoading={loadingIds.has(a.id)}
          />
        ))}
      </div>
    </div>
  )
}
