"use client"

import { ActivityLogEntry } from "@/components/dashboard/activity-log-entry"
import { MissionLogFilterBar } from "@/components/dashboard/mission-log-filter-bar"
import { RunCard } from "@/components/dashboard/run-card"
import { Button } from "@/components/ui/button"
import {
  groupMissionLogEntries,
  type MissionAgent,
  type MissionFilters,
  type MissionLogEntry,
} from "@/components/dashboard/mission-log-utils"
import type { ChannelId, ChannelStatusMap } from "@/lib/openclaw/channel-config"

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC"
}

interface MissionLogProps {
  entries: MissionLogEntry[]
  agents: MissionAgent[]
  filters: MissionFilters
  configuredChannelIds: ChannelId[]
  channels: ChannelStatusMap | null
  hasMore: boolean
  loadingMore: boolean
  onFiltersChange: (filters: MissionFilters) => void
  onLoadMore: () => void
}

export function MissionLog({
  entries,
  agents,
  filters,
  configuredChannelIds,
  channels,
  hasMore,
  loadingMore,
  onFiltersChange,
  onLoadMore,
}: MissionLogProps) {
  const agentBySlug = new Map(agents.map((agent) => [agent.agentSlug, agent]))
  const items = groupMissionLogEntries(entries, agentBySlug, filters.showRoutine)

  return (
    <section className="mb-6" aria-label="Mission log">
      <div className="mb-[8px] flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--tx)]">Mission Log</h2>
          <p className="text-[11px] text-[var(--tx3)]">Runs grouped by turn, with filters backed by the activity endpoint.</p>
        </div>
      </div>

      <MissionLogFilterBar
        filters={filters}
        agents={agents}
        configuredChannelIds={configuredChannelIds}
        channels={channels}
        onChange={onFiltersChange}
      />

      {items.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] p-[14px] text-[11px] text-[var(--tx3)]">
          No activity matches these filters.
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {items.map((item) =>
            item.kind === "run" ? (
              <RunCard key={item.id} item={item} />
            ) : (
              <div key={item.id} className="rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[6px]">
                <ActivityLogEntry
                  timestamp={formatTime(item.event.timestamp)}
                  agentName={item.event.agentName}
                  agentColor={agentBySlug.get(item.event.agentSlug ?? "")?.color ?? "#8BFCAE"}
                  message={item.event.action}
                  detail={item.event.detail ?? null}
                  channelId={item.event.channelId ?? null}
                />
              </div>
            ),
          )}
        </div>
      )}

      {hasMore && (
        <div className="mt-[10px]">
          <Button variant="outline" size="sm" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </section>
  )
}
