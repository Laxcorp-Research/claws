"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData, type SkillItem } from "@/stores/builder-store"
import { Button } from "@/components/ui/button"
import { Plus, X, ExternalLink } from "lucide-react"
import { MarketplaceSkillsModal } from "./marketplace-skills-modal"
import { Tooltip } from "./tooltip"

export function AgentSidebar() {
  const { nodes, selectedAgentId, selectAgent, addWorker, addAgent, skills, addSkill } = useBuilderStore()
  const [showMarketplace, setShowMarketplace] = useState(false)
  const [previewSkill, setPreviewSkill] = useState<SkillItem | null>(null)

  const selectedNode = nodes.find(n => n.id === selectedAgentId)
  const agentSkillIds: string[] = (selectedNode?.data as AgentNodeData)?.agentSkillIds || []

  const agents = nodes.map((n) => {
    const d = n.data as AgentNodeData
    return { id: n.id, name: d.name, role: d.role, color: d.color }
  })

  if (nodes.length === 0) {
    return (
      <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px] h-full">
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
    <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px] h-full">
      <div className="flex items-center gap-[4px] mb-2">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Agents</h4>
        <Tooltip text="Your AI team. Every Claw has 1 Orchestrator (manager), Workers (task executors), and 1 Critic (quality reviewer)." />
      </div>

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
                "flex items-center gap-1.5 py-1.5 px-2 rounded-[6px] cursor-pointer transition-colors w-full text-left border-none bg-transparent",
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

      <div className="flex items-center gap-[4px] mt-4 mb-[6px]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Skills</h4>
        <Tooltip text="Skills give agents abilities. Assign skills to agents in the properties panel on the right." />
        {selectedNode && (
          <span className="text-[9px] text-[var(--tx3)] truncate max-w-[80px] ml-auto">
            {(selectedNode.data as AgentNodeData).name}
          </span>
        )}
      </div>

      {skills.length === 0 ? (
        <p className="text-[10px] text-[var(--tx3)] px-[4px]">No skills added yet</p>
      ) : (
        <div className="space-y-[3px]">
          {skills.map((skill) => {
            const isAssigned = agentSkillIds.includes(skill.id)
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => setPreviewSkill(previewSkill?.id === skill.id ? null : skill)}
                className={cn(
                  "w-full flex items-center gap-[6px] px-[8px] py-[5px] rounded-[6px] text-[11px] text-left transition-colors border-none bg-transparent hover:bg-[var(--bg2)] cursor-pointer",
                  isAssigned && "text-[var(--ac)] font-medium",
                  !isAssigned && "text-[var(--tx2)]"
                )}
              >
                <span className="truncate flex-1">{skill.name}</span>
                {isAssigned && (
                  <span className="text-[9px] text-[var(--ac)] flex-shrink-0">assigned</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {previewSkill && (
        <div className="border border-[var(--bd)] rounded-[6px] p-[8px] mt-[6px] bg-[var(--bg)] relative">
          <button
            onClick={() => setPreviewSkill(null)}
            className="absolute top-[6px] right-[6px] p-[2px] rounded-[3px] hover:bg-[var(--bg2)] transition-colors cursor-pointer border-none bg-transparent"
            aria-label="Close preview"
          >
            <X className="w-[10px] h-[10px] text-[var(--tx3)]" />
          </button>
          <div className="text-[11px] font-medium text-[var(--tx)] mb-[2px] pr-[16px]">{previewSkill.name}</div>
          <span className="text-[9px] text-[var(--tx3)] uppercase">{previewSkill.category}</span>
          <p className="text-[10px] text-[var(--tx2)] leading-[1.4] mt-[4px]">
            Click to assign/unassign skills in the Properties panel on the right.
          </p>
          <a
            href={`/store/skills/${previewSkill.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[3px] text-[10px] text-[var(--ac)] hover:underline mt-[4px]"
          >
            View full details
            <ExternalLink className="w-[10px] h-[10px]" />
          </a>
        </div>
      )}

      {!selectedAgentId && skills.length > 0 && (
        <p className="text-[10px] text-[var(--tx3)] mt-[6px] px-[8px]">Select an agent to manage skills</p>
      )}

      <button
        type="button"
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
