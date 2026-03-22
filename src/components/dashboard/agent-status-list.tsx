"use client"

import { AgentStatusRow } from "./agent-status-row"

interface AgentStatus {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  status: "healthy" | "paused" | "error" | "offline"
  lastActive?: string
  errorMessage?: string
  queuedTasks?: number
  passRate?: number
}

interface AgentStatusListProps {
  agents: AgentStatus[]
  onPause?: (agentId: string) => void
  onResume?: (agentId: string) => void
  onRestart?: (agentId: string) => void
}

export function AgentStatusList({ agents, onPause, onResume, onRestart }: AgentStatusListProps) {
  return (
    <div className="border border-[var(--bd)] rounded-xl p-3.5">
      <h3 className="text-[13px] font-semibold mb-2.5">Agent status</h3>
      <div className="flex flex-col gap-1.5">
        {agents.map((agent) => (
          <AgentStatusRow
            key={agent.id}
            name={agent.name}
            role={agent.role}
            status={agent.status}
            lastActive={agent.lastActive}
            errorMessage={agent.errorMessage}
            queuedTasks={agent.queuedTasks}
            passRate={agent.passRate}
            canPause={agent.role === "WORKER"}
            onPause={onPause ? () => onPause(agent.id) : undefined}
            onResume={onResume ? () => onResume(agent.id) : undefined}
            onRestart={onRestart ? () => onRestart(agent.id) : undefined}
          />
        ))}
      </div>
      <p className="text-[10px] text-[var(--tx3)] mt-2">Orchestrator and Critic cannot be paused individually.</p>
    </div>
  )
}
