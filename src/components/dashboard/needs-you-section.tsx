"use client"

import { DocumentCard, type DocumentCardProps } from "./document-card"

export type NeedsYouApproval = Omit<DocumentCardProps, "workspaceId" | "className" | "onDecision">

interface NeedsYouSectionProps {
  workspaceId: string
  approvals: NeedsYouApproval[]
  onDecision?: (humanRequestId: string) => void
}

export function NeedsYouSection({ workspaceId, approvals, onDecision }: NeedsYouSectionProps) {
  if (approvals.length === 0) return null

  return (
    <section
      aria-label="Needs you"
      className="border border-[var(--warn)] rounded-[8px] p-[12px] bg-[var(--warnbg)] mb-6"
    >
      <h2 className="text-[12px] font-semibold text-[var(--warn)] mb-[6px]">
        Needs you ({approvals.length} {approvals.length === 1 ? "item" : "items"})
      </h2>
      <div className="flex flex-col gap-[6px]">
        {approvals.map((approval) => (
          <DocumentCard
            key={approval.humanRequestId ?? approval.fileVersionId}
            workspaceId={workspaceId}
            fileVersionId={approval.fileVersionId}
            title={approval.title}
            preview={approval.preview}
            logicalPath={approval.logicalPath}
            deliverableKind={approval.deliverableKind}
            humanRequestId={approval.humanRequestId}
            timestamp={approval.timestamp}
            decision={approval.decision ?? "NONE"}
            latestLabel={approval.latestLabel}
            className="max-w-none"
            onDecision={() => {
              if (approval.humanRequestId) onDecision?.(approval.humanRequestId)
            }}
          />
        ))}
      </div>
    </section>
  )
}
