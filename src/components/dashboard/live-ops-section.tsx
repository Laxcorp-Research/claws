"use client"

import { AgentLiveTile } from "@/components/dashboard/agent-live-tile"
import { RunChain } from "@/components/dashboard/run-chain"
import {
  deriveAgentLiveViews,
  deriveRunChain,
  type LiveOpsAgent,
} from "@/components/dashboard/live-ops-utils"
import type { MissionLogEntry } from "@/components/dashboard/mission-log-utils"

interface LiveOpsSectionProps {
  agents: LiveOpsAgent[]
  events: MissionLogEntry[]
  actionLoadingId?: string | null
  onPauseAgent: (id: string) => void
  onResumeAgent: (id: string) => void
}

export function LiveOpsSection({ agents, events, actionLoadingId, onPauseAgent, onResumeAgent }: LiveOpsSectionProps) {
  const views = deriveAgentLiveViews(agents, events)
  const chain = deriveRunChain(events)

  return (
    <section className="mb-6" aria-label="Live ops">
      <div className="mb-[8px]">
        <h2 className="text-[14px] font-semibold text-[var(--tx)]">Live Ops</h2>
        <p className="text-[11px] text-[var(--tx3)]">Current agent state derived from recent run events and deployed pause truth.</p>
      </div>
      <RunChain chain={chain} agents={agents} />
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
        {views.map((view) => (
          <AgentLiveTile
            key={view.agent.id}
            view={view}
            actionLoadingId={actionLoadingId}
            onPauseAgent={onPauseAgent}
            onResumeAgent={onResumeAgent}
          />
        ))}
      </div>
    </section>
  )
}
