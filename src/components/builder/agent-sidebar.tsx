"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import { Button } from "@/components/ui/button"
import { Settings, Mail, Users, Calendar, MessageSquare, Wrench, Check, Plus } from "lucide-react"
import type { ReactNode } from "react"
import { MarketplaceSkillsModal } from "./marketplace-skills-modal"

const ICON_CLASS = "w-3.5 h-3.5 flex-shrink-0"

const CATEGORY_ICONS: Record<string, ReactNode> = {
  CORE: <Settings className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  EMAIL: <Mail className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  EMAIL_SENDER: <Mail className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  EMAIL_READER: <Mail className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  CRM: <Users className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  CALENDAR: <Calendar className={`${ICON_CLASS} text-[var(--tx3)]`} />,
  COMMUNICATION: <MessageSquare className={`${ICON_CLASS} text-[var(--tx3)]`} />,
}

const DEFAULT_SKILL_ICON = <Wrench className={`${ICON_CLASS} text-[var(--tx3)]`} />

export function AgentSidebar() {
  const { nodes, selectedAgentId, selectAgent, addWorker, addAgent, skills, toggleSkill, addSkill } = useBuilderStore()
  const [showMarketplace, setShowMarketplace] = useState(false)

  const selectedNode = nodes.find(n => n.id === selectedAgentId)
  const agentSkillIds: string[] = (selectedNode?.data as AgentNodeData)?.agentSkillIds || []

  const agents = nodes.map((n) => {
    const d = n.data as AgentNodeData
    return { id: n.id, name: d.name, role: d.role, color: d.color }
  })

  if (nodes.length === 0) {
    return (
      <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Agents</h4>
        <div className="py-3 text-center">
          <p className="text-[12px] text-[var(--tx2)]">No agents yet</p>
          <p className="text-[11px] text-[var(--tx3)] mt-1">Add an Orchestrator to get started</p>
        </div>
        <Button variant="primary" size="sm" className="w-full text-[10px]" onClick={() => addAgent({ name: "Orchestrator", role: "ORCHESTRATOR" })}>
          + Add Orchestrator
        </Button>
      </div>
    )
  }

  return (
    <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
      <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Agents</h4>

      <div className="space-y-[3px]">
        {agents.map((agent) => {
          const isSelected = agent.id === selectedAgentId
          const isOrch = agent.role === "ORCHESTRATOR"
          const isCritic = agent.role === "CRITIC"

          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => selectAgent(agent.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex items-center gap-1.5 py-1.5 px-2 rounded-[6px] cursor-pointer transition-colors w-full text-left",
                isSelected && "bg-[var(--bg3)] text-[var(--tx)] font-semibold",
                !isSelected && "hover:bg-[var(--bg2)]",
                isOrch && "bg-[var(--acbg)] text-[var(--ac)] border-l-[3px] border-l-[var(--ac)] font-semibold",
                isCritic && "border-l-[3px] border-l-[#8b5cf6] font-semibold"
              )}
            >
              <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ backgroundColor: agent.color }} aria-hidden="true" />
              <span className="truncate">{agent.name}</span>
            </button>
          )
        })}
      </div>

      <Button variant="outline" size="sm" className="w-full mt-2 text-[10px]" onClick={addWorker}>
        + Add worker
      </Button>

      <div className="flex items-center justify-between mb-[6px] mt-4">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Skills</h4>
        {selectedNode && (
          <span className="text-[9px] text-[var(--tx3)] truncate max-w-[100px]">
            {(selectedNode.data as AgentNodeData).name}
          </span>
        )}
      </div>

      <div className="space-y-[3px]">
        {skills.map((skill) => {
          const isAssigned = agentSkillIds.includes(skill.id)
          const isDisabled = !selectedAgentId

          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => { if (selectedAgentId) toggleSkill(selectedAgentId, skill.id) }}
              disabled={isDisabled}
              className={cn(
                "w-full flex items-center gap-[6px] px-[8px] py-[6px] rounded-[6px] text-[11px] text-left transition-colors border-none",
                isDisabled && "opacity-40 cursor-not-allowed bg-transparent",
                !isDisabled && isAssigned && "bg-[var(--acbg)] text-[var(--ac)] font-medium cursor-pointer",
                !isDisabled && !isAssigned && "text-[var(--tx2)] hover:bg-[var(--bg2)] cursor-pointer bg-transparent"
              )}
            >
              <span className="flex items-center">{CATEGORY_ICONS[skill.category] || DEFAULT_SKILL_ICON}</span>
              <span className="flex-1 truncate">{skill.name}</span>
              {isAssigned && <Check className="w-[12px] h-[12px] text-[var(--ac)] flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      {!selectedAgentId && skills.length > 0 && (
        <p className="text-[10px] text-[var(--tx3)] mt-[6px] px-[8px]">Select an agent to manage skills</p>
      )}

      <button
        onClick={() => setShowMarketplace(true)}
        className="w-full flex items-center gap-[6px] px-[8px] py-[6px] rounded-[6px] text-[11px] text-[var(--ac)] hover:bg-[var(--acbg)] transition-colors mt-[4px] cursor-pointer border-none bg-transparent"
      >
        <Plus className="w-[14px] h-[14px]" />
        Browse marketplace
      </button>

      <MarketplaceSkillsModal
        isOpen={showMarketplace}
        onClose={() => setShowMarketplace(false)}
        existingSkillIds={skills.map(s => s.id)}
        onInstall={(skill) => addSkill({ id: skill.id, name: skill.name, category: skill.category })}
      />
    </div>
  )
}
