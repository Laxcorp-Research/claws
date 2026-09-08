"use client"

import { DocumentCard, type DocumentCardProps } from "./document-card"
import { HttpActionCard } from "./http-action-card"
import type { HttpActionCardView } from "@/lib/openclaw/http-action-card"

export type NeedsYouApproval = Omit<
  DocumentCardProps,
  | "workspaceId"
  | "className"
  | "onDecision"
  | "fileVersionId"
  | "logicalPath"
  | "deliverableKind"
  | "humanRequestId"
> & {
  kind?: "deliverable" | "http_action"
  fileVersionId?: string
  logicalPath?: string
  deliverableKind?: DocumentCardProps["deliverableKind"] | "http_action"
  humanRequestId: string
  httpAction?: HttpActionCardView
}

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
        {approvals.map((approval) =>
          approval.kind === "http_action" && approval.httpAction && approval.humanRequestId ? (
            <HttpActionCard
              key={approval.humanRequestId}
              workspaceId={workspaceId}
              humanRequestId={approval.humanRequestId}
              timestamp={approval.timestamp}
              card={approval.httpAction}
              decision={approval.decision ?? "NONE"}
              className="max-w-none"
              onDecision={() => {
                if (approval.humanRequestId) onDecision?.(approval.humanRequestId)
              }}
            />
          ) : (
            <DocumentCard
              key={approval.humanRequestId ?? approval.fileVersionId}
              workspaceId={workspaceId}
              fileVersionId={approval.fileVersionId ?? ""}
              title={approval.title}
              preview={approval.preview}
              logicalPath={approval.logicalPath ?? ""}
              deliverableKind={approval.deliverableKind === "report" ? "report" : "decision"}
              humanRequestId={approval.humanRequestId}
              timestamp={approval.timestamp}
              decision={approval.decision ?? "NONE"}
              latestLabel={approval.latestLabel}
              className="max-w-none"
              onDecision={() => {
                if (approval.humanRequestId) onDecision?.(approval.humanRequestId)
              }}
            />
          ),
        )}
      </div>
    </section>
  )
}
