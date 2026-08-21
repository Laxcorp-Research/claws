"use client"

import { useState } from "react"
import { PendingApprovalCard } from "./pending-approval-card"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"

// PR-6: replaces the old <PendingApprovals> wrapper. Same behaviour (approve
// inline, reject-with-optional-feedback via modal) but calm-by-default - the
// whole section is absent when there's nothing waiting, so a quiet Claw shows
// no "Needs you" chrome at all. (Today this is always empty: nothing produces
// HUMAN_REQUEST yet - see the PR-6 audit. The section is built so it lights up
// for free once a producer lands.)

interface PendingApproval {
  id: string
  title: string
  description?: string
  agentName: string
  agentColor: string
  timestamp: string
}

interface NeedsYouSectionProps {
  approvals: PendingApproval[]
  onApprove: (id: string) => Promise<void>
  onReject: (id: string, feedback?: string) => Promise<void>
}

export function NeedsYouSection({ approvals, onApprove, onReject }: NeedsYouSectionProps) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectFeedback, setRejectFeedback] = useState("")
  const [rejectLoading, setRejectLoading] = useState(false)

  if (approvals.length === 0) return null

  const handleApprove = async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id))
    try {
      await onApprove(id)
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleRejectClick = (id: string) => {
    setRejectTarget(id)
    setRejectFeedback("")
  }

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return
    setRejectLoading(true)
    try {
      await onReject(rejectTarget, rejectFeedback || undefined)
      setRejectTarget(null)
      setRejectFeedback("")
    } finally {
      setRejectLoading(false)
    }
  }

  const handleRejectCancel = () => {
    setRejectTarget(null)
    setRejectFeedback("")
  }

  return (
    <>
      <section
        aria-label="Needs you"
        className="border border-[var(--warn)] rounded-[8px] p-[12px] bg-[var(--warnbg)] mb-6"
      >
        <h2 className="text-[12px] font-semibold text-[#92400e] dark:text-amber-300 mb-[6px]">
          Needs you ({approvals.length} {approvals.length === 1 ? "item" : "items"})
        </h2>
        <div className="flex flex-col gap-[6px]">
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
              onReject={handleRejectClick}
              isLoading={loadingIds.has(a.id)}
            />
          ))}
        </div>
      </section>

      <Modal
        open={rejectTarget !== null}
        onClose={handleRejectCancel}
        title="Reject this item?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={handleRejectCancel} disabled={rejectLoading}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRejectConfirm} loading={rejectLoading}>
              Reject
            </Button>
          </>
        }
      >
        <textarea
          value={rejectFeedback}
          onChange={(e) => setRejectFeedback(e.target.value)}
          placeholder="Optional feedback for the agent..."
          rows={3}
          className="w-full border border-[var(--bd)] rounded-[6px] bg-[var(--bg)] text-[var(--tx)] text-[11px] p-2 resize-none focus:outline-none focus:border-[var(--tx)]"
        />
      </Modal>
    </>
  )
}
