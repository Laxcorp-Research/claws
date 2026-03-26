"use client"

import { AgentStatusRow } from "./agent-status-row"

interface AgentStatus {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  status: "running" | "healthy" | "paused" | "error" | "starting" | "offline"
  lastActive?: string
  errorMessage?: string
  retryIn?: string
  queuedTasks?: number
  passRate?: number
}

interface AgentStatusListProps {
  agents: AgentStatus[]
  onPauseAgent: (agentId: string) => void
  onResumeAgent: (agentId: string) => void
  onRestartAgent: (agentId: string) => void
  actionLoadingId?: string | null
}

export function AgentStatusList({
  agents,
  onPauseAgent,
  onResumeAgent,
  onRestartAgent,
  actionLoadingId,
}: AgentStatusListProps) {
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
            retryIn={agent.retryIn}
            queuedTasks={agent.queuedTasks}
            passRate={agent.passRate}
            canPause={agent.role === "WORKER"}
            onPause={() => onPauseAgent(agent.id)}
            onResume={() => onResumeAgent(agent.id)}
            onRestart={() => onRestartAgent(agent.id)}
            isActionLoading={actionLoadingId === agent.id}
          />
        ))}
      </div>
      <p className="text-[10px] text-[var(--tx3)] mt-[8px]">
        Note: Orchestrator and Critic cannot be paused individually — they&apos;re essential for Claw operation. Use &quot;Pause all&quot; to stop the entire Claw.
      </p>
    </div>
  )
}
