"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

interface ActivityLogEntryProps {
  timestamp: string
  agentName: string
  agentColor: string
  message: string
  // PR-4: full expand-on-click context behind the short `message` summary.
  // null/absent → no expand affordance (the row is just its one-line message).
  detail?: string | null
}

export function ActivityLogEntry({ timestamp, agentName, agentColor, message, detail }: ActivityLogEntryProps) {
  const [expanded, setExpanded] = useState(false)
  // Only offer expand when there's genuinely MORE than the message already
  // shows — a detail equal to the message is just noise.
  const trimmedDetail = typeof detail === "string" ? detail.trim() : ""
  const hasDetail = trimmedDetail.length > 0 && trimmedDetail !== message.trim()

  return (
    <div className="flex gap-2 py-[5px] border-b border-[var(--bd)] last:border-b-0 text-[11px] items-start">
      <span className="text-[var(--tx3)] min-w-[40px] font-mono text-[10px]">{timestamp}</span>
      <span className="font-semibold min-w-[56px]" style={{ color: agentColor }}>{agentName}</span>
      <div className="flex-1 min-w-0">
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={cn(
              "text-[var(--tx2)] text-left w-full cursor-pointer hover:text-[var(--tx1)] transition-colors",
              !expanded && "line-clamp-2",
            )}
            title={expanded ? "Click to collapse" : "Click to expand"}
          >
            {message}
          </button>
        ) : (
          <span className="text-[var(--tx2)] line-clamp-2 block">{message}</span>
        )}
        {hasDetail && expanded && (
          <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-[var(--tx3)] bg-[var(--bg2)] rounded p-2 font-mono max-h-[240px] overflow-y-auto">
            {detail}
          </pre>
        )}
      </div>
    </div>
  )
}
