"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ProviderChannelBadge } from "./provider-channel-badge"
import { Tooltip } from "@/components/ui/tooltip"

interface ActivityLogEntryProps {
  timestamp: string
  agentName: string
  agentColor: string
  message: string
  // PR-4: full expand-on-click context behind the short `message` summary.
  // null/absent → no expand affordance (the row is just its one-line message).
  detail?: string | null
  channelId?: string | null
}

export function ActivityLogEntry({ timestamp, agentName, agentColor, message, detail, channelId }: ActivityLogEntryProps) {
  const [expanded, setExpanded] = useState(false)
  // Only offer expand when there's genuinely MORE than the message already
  // shows — a detail equal to the message is just noise.
  const trimmedDetail = typeof detail === "string" ? detail.trim() : ""
  const hasDetail = trimmedDetail.length > 0 && trimmedDetail !== message.trim()
  const viaBadge = <ProviderChannelBadge channelId={channelId} className="ml-1.5 align-middle" />

  return (
    <div className="flex gap-2 py-[5px] border-b border-[var(--bd)] last:border-b-0 text-[11px] items-start">
      {/* PR-4d: widened from 40px → 64px to fit the " UTC" suffix that
          formatTime now emits (e.g. "14:10:00 UTC"). The font-mono digit
          width keeps the column edge stable across rows. */}
      <span className="text-[var(--tx3)] min-w-[64px] font-mono text-[10px]">{timestamp}</span>
      {/* Agent color as a decorative dot, name in --tx for WCAG AA readability
          (the agent hues were near-invisible as text on white). */}
      <span className="font-semibold min-w-[56px] text-[var(--tx)] inline-flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: agentColor }} aria-hidden="true" />
        {agentName}
      </span>
      <div className="flex-1 min-w-0">
        {hasDetail ? (
          <Tooltip
            content={expanded ? "Click to collapse" : "Click to expand"}
            align="center"
            triggerClassName="block w-full"
          >
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={cn(
                "text-[var(--tx2)] text-left w-full cursor-pointer hover:text-[var(--tx1)] transition-colors",
                // truncate-allowlist: expand/collapse multi-line preview (line-clamp-2)
                !expanded && "line-clamp-2",
              )}
            >
              {/* PR-4d: explicit chevron glyph instead of implicit
                  cursor:pointer + line-clamp affordance. The user reported the
                  previous affordance wasn't discoverable enough — rows with
                  hidden detail looked identical to rows without. The chevron
                  fixes that. aria-hidden because the button's aria-expanded
                  already conveys the state to assistive tech. */}
              <span
                className="inline-block w-[10px] mr-1 text-[var(--tx3)] select-none"
                aria-hidden="true"
              >
                {expanded ? "▾" : "▸"}
              </span>
              {message}
              {viaBadge}
            </button>
          </Tooltip>
        ) : (
          <span
            // truncate-allowlist: non-expandable multi-line preview (line-clamp-2)
            className="text-[var(--tx2)] line-clamp-2 block"
          >
            {message}
            {viaBadge}
          </span>
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
