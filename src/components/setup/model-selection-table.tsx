"use client"

import { AI_MODELS } from "@/lib/models"

interface AgentModelRow {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  model: string
}

interface ModelSelectionTableProps {
  agents: AgentModelRow[]
  onModelChange: (agentId: string, model: string) => void
}

const ROLE_COLORS: Record<string, string> = {
  ORCHESTRATOR: "text-[var(--ac)]",
  WORKER: "text-[var(--tx2)]",
  CRITIC: "text-[#5b21b6]",
}

export function ModelSelectionTable({ agents, onModelChange }: ModelSelectionTableProps) {
  return (
    <table className="w-full text-xs mb-3.5 border-collapse">
      <thead>
        <tr>
          <th className="text-left text-[11px] font-semibold text-[var(--tx2)] px-2 py-1.5">Agent</th>
          <th className="text-left text-[11px] font-semibold text-[var(--tx2)] px-2 py-1.5">Role</th>
          <th className="text-left text-[11px] font-semibold text-[var(--tx2)] px-2 py-1.5">Model</th>
          <th className="text-right text-[11px] font-semibold text-[var(--tx2)] px-2 py-1.5">Est. cost</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((agent) => {
          const selected = AI_MODELS.find((m) => m.value === agent.model)
          return (
            <tr key={agent.id} className="border-b border-[var(--bd)]">
              <td className="px-2 py-1.5 font-semibold">{agent.name}</td>
              <td className={`px-2 py-1.5 text-[10px] ${ROLE_COLORS[agent.role] || ""}`}>
                {agent.role.charAt(0) + agent.role.slice(1).toLowerCase()}
              </td>
              <td className="px-2 py-1.5">
                <select
                  value={agent.model}
                  onChange={(e) => onModelChange(agent.id, e.target.value)}
                  className="px-1.5 py-[3px] rounded-md text-[11px] border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
                >
                  {AI_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label} ({m.provider}) — ~${m.costPer1kCalls}/call</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1.5 text-right text-[var(--tx3)] text-[10px]">
                {selected ? `~$${selected.costPer1kCalls}/call` : "—"}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
