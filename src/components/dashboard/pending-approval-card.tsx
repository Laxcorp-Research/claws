"use client"

interface PendingApprovalCardProps {
  id: string
  title: string
  description: string
  agentName: string
  agentColor: string
  timestamp: string
  onApprove: (id: string) => void
  onReject: (id: string) => void
  isLoading?: boolean
}

export function PendingApprovalCard({ id, title, description, agentName, agentColor, timestamp, onApprove, onReject, isLoading }: PendingApprovalCardProps) {
  return (
    <div className="flex items-center justify-between bg-[var(--bg)] p-[8px_10px] rounded-md">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold" style={{ color: agentColor }}>{agentName}</span>
          <span className="text-[11px] text-[var(--tx)] truncate">{title}</span>
        </div>
        <p className="text-[11px] text-[var(--tx2)] truncate">{description}</p>
        <span className="text-[10px] text-[var(--tx3)]">{timestamp}</span>
      </div>
      <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
        <button
          onClick={() => onReject(id)}
          disabled={isLoading}
          className="text-[9px] px-2 py-px rounded border border-[var(--bd)] text-[var(--tx2)] hover:bg-[var(--bg2)] hover:border-[var(--bd2)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reject
        </button>
        <button
          onClick={() => onApprove(id)}
          disabled={isLoading}
          className="text-[9px] px-2 py-px rounded bg-[var(--tx)] text-white hover:bg-[var(--tx)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve
        </button>
      </div>
    </div>
  )
}
