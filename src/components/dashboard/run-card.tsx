"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ActivityLogEntry } from "@/components/dashboard/activity-log-entry"
import { providerChannelLabel } from "@/components/dashboard/provider-channel-badge"
import { cn } from "@/lib/utils"
import type { MissionLogEntry, MissionRunCard } from "@/components/dashboard/mission-log-utils"

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC"
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "running"
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 100) / 10
  return `${seconds}s`
}

function statusIcon(status: MissionRunCard["status"]) {
  if (status === "success") return <span className="text-[var(--ok)]">✓</span>
  if (status === "failed") return <span className="text-[var(--err)]">✗</span>
  return <span className="h-[16px] w-[16px] rounded-full border-2 border-current border-t-transparent animate-spin text-[var(--tx3)]" aria-label="Open run" />
}

function sequenceRow(event: MissionLogEntry, agentColor: string) {
  return (
    <ActivityLogEntry
      key={event.id}
      timestamp={formatTime(event.timestamp)}
      agentName={event.agentName}
      agentColor={agentColor}
      message={event.action}
      detail={event.detail ?? null}
      channelId={event.channelId ?? null}
    />
  )
}

interface RunCardProps {
  item: MissionRunCard
}

export function RunCard({ item }: RunCardProps) {
  const [expanded, setExpanded] = useState(false)
  const provider = providerChannelLabel(item.channelId)

  return (
    <article
      className={cn(
        "rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px]",
        item.routine && "bg-[var(--bg2)]",
      )}
      aria-label={`Run ${item.taskName}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-start gap-[10px] text-left"
      >
        <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center text-[14px]" aria-hidden={item.status !== "open"}>
          {statusIcon(item.status)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] font-semibold text-[var(--tx)]", item.routine && "text-[var(--tx2)]")}>
            {item.taskName}
          </span>
          <span className="mt-[2px] flex flex-wrap items-center gap-[8px] text-[10px] text-[var(--tx3)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.agentColor }} aria-hidden="true" />
              {item.agentName}
            </span>
            <span>{formatDuration(item.durationMs)}</span>
            <span>{formatTime(item.startedAt)}</span>
            <span>{item.events.length} event{item.events.length === 1 ? "" : "s"}</span>
            {provider && <Badge>via {provider}</Badge>}
            {item.routine && <Badge>Routine</Badge>}
          </span>
        </span>
        <span className="mt-[2px] inline-block w-[10px] text-[var(--tx3)]" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="mt-[8px] border-t border-[var(--bd)] pt-[6px]">
          {item.pageBoundaryCut && (
            <p className="mb-[6px] text-[10px] text-[var(--tx3)]">Earlier events may be on the previous page.</p>
          )}
          {item.events.map((event) => sequenceRow(event, item.agentColor))}
        </div>
      )}
    </article>
  )
}
