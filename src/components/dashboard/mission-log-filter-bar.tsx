"use client"

import { FilterPills } from "@/components/ui/filter-pills"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { ChannelId, ChannelStatusMap } from "@/lib/openclaw/channel-config"
import type { MissionAgent, MissionFilters, MissionTimeFilter, MissionTypeFilter } from "@/components/dashboard/mission-log-utils"

const TYPE_OPTIONS: Array<{ value: MissionTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "tasks", label: "Tasks" },
  { value: "messages", label: "Messages" },
  { value: "errors", label: "Errors" },
]

const TIME_OPTIONS: Array<{ value: MissionTimeFilter; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "all", label: "All" },
]

const CHANNEL_LABELS: Record<ChannelId | "webchat", string> = {
  webchat: "Webchat",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  msteams: "Microsoft Teams",
}

interface MissionLogFilterBarProps {
  filters: MissionFilters
  agents: MissionAgent[]
  configuredChannelIds: ChannelId[]
  channels: ChannelStatusMap | null
  onChange: (filters: MissionFilters) => void
}

export function MissionLogFilterBar({ filters, agents, configuredChannelIds, channels, onChange }: MissionLogFilterBarProps) {
  const agentOptions = [
    { value: "", label: "All agents" },
    ...agents.map((agent) => ({ value: agent.agentSlug, label: agent.name, color: agent.color })),
  ]
  const configuredChannels = configuredChannelIds.filter((channelId) => channels?.[channelId]?.configured ?? true)
  const channelOptions = ["webchat", ...configuredChannels] as Array<ChannelId | "webchat">

  return (
    <div className="rounded-[12px] border border-[var(--bd)] bg-[var(--bg)] p-[10px] mb-[10px]" aria-label="Mission log filters">
      <div className="flex flex-wrap items-end gap-[8px]">
        <div className="min-w-[160px]">
          <p className="mb-[4px] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">Agent</p>
          <div className="flex flex-wrap gap-1.5">
            {agentOptions.map((agent) => {
              const active = filters.agentSlug === agent.value
              return (
                <button
                  key={agent.value || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ ...filters, agentSlug: agent.value })}
                  className={cn(
                    "inline-flex h-[28px] items-center gap-[6px] rounded-[8px] border px-[10px] text-[11px] font-medium transition-colors",
                    active
                      ? "border-[var(--tx)] bg-[var(--tx)] text-[var(--bg)]"
                      : "border-[var(--bd)] bg-transparent text-[var(--tx2)] hover:border-[var(--bd2)]",
                  )}
                >
                  {"color" in agent && agent.color && <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: agent.color }} aria-hidden="true" />}
                  {agent.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-w-[240px]">
          <p className="mb-[4px] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">Type</p>
          <div className="flex items-start gap-1.5">
            <FilterPills
              options={TYPE_OPTIONS}
              value={filters.type}
              onChange={(value) => onChange({ ...filters, type: value as MissionTypeFilter })}
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              aria-pressed={filters.showRoutine}
              onClick={() => onChange({ ...filters, showRoutine: !filters.showRoutine })}
              className={cn(
                "h-[24px] shrink-0 rounded-[8px] border px-[10px] text-[11px] font-medium transition-colors",
                filters.showRoutine
                  ? "border-[var(--tx)] bg-[var(--tx)] text-[var(--bg)]"
                  : "border-[var(--bd)] bg-transparent text-[var(--tx2)] hover:border-[var(--bd2)]",
              )}
            >
              Routine
            </button>
          </div>
        </div>

        <label className="min-w-[130px]">
          <span className="mb-[4px] block text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">Channel</span>
          <Select
            variant="compact"
            value={filters.channelId}
            onChange={(event) => onChange({ ...filters, channelId: event.target.value })}
            className="h-[30px] rounded-[8px] text-[11px]"
          >
            <option value="">All channels</option>
            {channelOptions.map((channelId) => (
              <option key={channelId} value={channelId}>{CHANNEL_LABELS[channelId]}</option>
            ))}
          </Select>
        </label>

        <label className="min-w-[92px]">
          <span className="mb-[4px] block text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">Time</span>
          <Select
            variant="compact"
            value={filters.time}
            onChange={(event) => onChange({ ...filters, time: event.target.value as MissionTimeFilter })}
            className="h-[30px] rounded-[8px] text-[11px]"
          >
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>

        <label className="min-w-[180px] flex-1">
          <span className="mb-[4px] block text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">Search</span>
          <Input
            variant="compact"
            value={filters.q}
            onChange={(event) => onChange({ ...filters, q: event.target.value })}
            placeholder="Search activity..."
            className="h-[30px] text-[11px]"
          />
        </label>
      </div>
    </div>
  )
}
