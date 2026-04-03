"use client"

import { Button } from "@/components/ui/button"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

interface PendingApprovalCardProps {
  id: string
  title: string
  description?: string
  agentName: string
  agentColor: string
  timestamp: string
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onReview?: (id: string) => void
  isLoading?: boolean
}

export function PendingApprovalCard({
  id,
  title,
  description,
  agentName,
  agentColor,
  timestamp,
  onApprove,
  onReject,
  onReview,
  isLoading,
}: PendingApprovalCardProps) {
  return (
    <div className="flex items-center justify-between bg-[var(--bg)] p-[8px_10px] rounded-[6px]">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: agentColor }}>
            {agentName}
          </span>
          <TruncateWithTooltip className="text-[11px] font-medium text-[var(--tx)]">{title}</TruncateWithTooltip>
        </div>
        {description && (
          <TruncateWithTooltip className="text-[10px] text-[var(--tx2)] mt-[2px]" as="p">{description}</TruncateWithTooltip>
        )}
        <span className="text-[10px] text-[var(--tx3)] mt-[2px]">{timestamp}</span>
      </div>
      <div className="flex items-center gap-[4px] ml-2 flex-shrink-0">
        <Button
          variant="primary"
          className="text-[9px] px-[8px] py-[2px] h-auto"
          onClick={() => onApprove(id)}
          disabled={isLoading}
          loading={isLoading}
        >
          Approve
        </Button>
        {onReview && (
          <Button
            variant="outline"
            className="text-[9px] px-[8px] py-[2px] h-auto"
            onClick={() => onReview(id)}
            disabled={isLoading}
          >
            Review
          </Button>
        )}
        <Button
          variant="outline"
          className="text-[9px] px-[8px] py-[2px] h-auto"
          onClick={() => onReject(id)}
          disabled={isLoading}
        >
          Reject
        </Button>
      </div>
    </div>
  )
}
