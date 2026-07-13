"use client"

import type { ReactNode } from "react"
import { StatusBadge } from "@/components/ui/status-badge"
import { StatChip, type StatChipTone } from "@/components/dashboard/stat-chip"
import { formatCurrency } from "@/lib/utils/format"
import { mapWorkspaceStatus } from "@/lib/utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import type { ChannelId, ChannelLiveState, ChannelStatusMap } from "@/lib/openclaw/channel-config"

const CHANNEL_LABELS: Record<ChannelId, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  msteams: "Microsoft Teams",
}

const channelTone: Record<ChannelLiveState, StatChipTone> = {
  connected: "ok",
  connecting: "warn",
  error: "err",
  unknown: "unknown",
}

function channelLabel(channelId: ChannelId, live: ChannelLiveState): string {
  const state = live === "connecting" ? "configured-not-live" : live
  return `${CHANNEL_LABELS[channelId]}: ${state}`
}

interface CommandStripProps {
  workspaceName: string
  workspaceStatus: string
  agentsActive: number
  agentsTotal: number
  tasksToday: number
  estimatedCostToday: number
  estimatedCostTodayCalls: number
  /** When false, Cost today is fully backed by ActivityLog.apiCost (no "est."). */
  estimatedCostTodayIsEstimate?: boolean
  configuredChannelIds: ChannelId[]
  channels: ChannelStatusMap | null
  actions?: ReactNode
}

export function CommandStrip({
  workspaceName,
  workspaceStatus,
  agentsActive,
  agentsTotal,
  tasksToday,
  estimatedCostToday,
  estimatedCostTodayCalls,
  estimatedCostTodayIsEstimate = true,
  configuredChannelIds,
  channels,
  actions,
}: CommandStripProps) {
  const hasActivity = estimatedCostTodayCalls > 0 || estimatedCostToday > 0
  const costValue = !hasActivity
    ? "—"
    : estimatedCostTodayIsEstimate
      ? `~${formatCurrency(estimatedCostToday)} est.`
      : formatCurrency(estimatedCostToday)

  return (
    <section className="mb-3 rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-[14px] py-[12px]" aria-label="Command strip">
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 text-[16px] font-semibold text-[var(--tx)]"><TruncatedText>{workspaceName}</TruncatedText></h1>
          <StatusBadge status={mapWorkspaceStatus(workspaceStatus)} />
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        <StatChip label="Agents" value={`${agentsActive}/${agentsTotal} active`} />
        <StatChip label="Tasks today" value={tasksToday.toLocaleString()} />
        <StatChip label="Cost today" value={costValue} />
        {configuredChannelIds.map((channelId) => {
          const live = channels?.[channelId]?.live ?? "unknown"
          const label = channelLabel(channelId, live)
          return (
            <StatChip
              key={channelId}
              label={CHANNEL_LABELS[channelId]}
              value=""
              dotTone={channelTone[live]}
              title={label}
              ariaLabel={label}
            />
          )
        })}
      </div>
    </section>
  )
}
