"use client"

import { formatModelEstCost } from "@/lib/models"
import { ModelPicker } from "@/components/shared/model-picker"
import {
  BYOK_COST_DISCLAIMER,
  shouldShowByokCostDisclaimer,
} from "@/lib/models/byok-disclaimer"

interface AgentModelRow {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  model: string
}

interface ModelSelectionTableProps {
  agents: AgentModelRow[]
  onModelChange: (agentId: string, model: string) => void
  creditMode?: boolean
  configuredProviders?: string[]
}

const ROLE_COLORS: Record<string, string> = {
  ORCHESTRATOR: "text-[var(--ac-text)]",
  WORKER: "text-[var(--tx2)]",
  CRITIC: "text-[#5b21b6]",
}

export function ModelSelectionTable({
  agents,
  onModelChange,
  creditMode,
  configuredProviders,
}: ModelSelectionTableProps) {
  const showByokDisclaimer = shouldShowByokCostDisclaimer({
    creditMode,
    configuredProviders,
    selectedModels: agents.map((a) => a.model),
  })

  return (
    <div className="mb-3.5">
      <table className="w-full text-xs border-collapse">
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
            return (
              <tr key={agent.id} className="border-b border-[var(--bd)]">
                <td className="px-2 py-1.5 font-semibold">{agent.name}</td>
                <td className={`px-2 py-1.5 text-[10px] ${ROLE_COLORS[agent.role] || ""}`}>
                  {agent.role.charAt(0) + agent.role.slice(1).toLowerCase()}
                </td>
                <td className="px-2 py-1.5 min-w-[220px]">
                  <ModelPicker
                    value={agent.model}
                    onChange={(val) => onModelChange(agent.id, val)}
                    creditMode={creditMode}
                    configuredProviders={configuredProviders}
                  />
                </td>
                <td className="px-2 py-1.5 text-right text-[var(--tx3)] text-[10px]">
                  {formatModelEstCost(agent.model)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {showByokDisclaimer && (
        <p
          data-testid="byok-cost-disclaimer"
          className="text-[10px] text-[var(--tx3)] mt-[8px]"
        >
          {BYOK_COST_DISCLAIMER}
        </p>
      )}
    </div>
  )
}
