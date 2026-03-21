"use client"

import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import { Button } from "@/components/ui/button"
import { Settings, Mail, Users, Calendar, MessageSquare, Wrench } from "lucide-react"
import type { ReactNode } from "react"

const ICON_CLASS = "w-3 h-3 text-[var(--tx3)]"

const CATEGORY_ICONS: Record<string, ReactNode> = {
  CORE: <Settings className={ICON_CLASS} />,
  EMAIL: <Mail className={ICON_CLASS} />,
  CRM: <Users className={ICON_CLASS} />,
  CALENDAR: <Calendar className={ICON_CLASS} />,
  MESSAGING: <MessageSquare className={ICON_CLASS} />,
}

const DEFAULT_SKILL_ICON = <Wrench className={ICON_CLASS} />

export function AgentSidebar() {
  const { nodes, selectedAgentId, selectAgent, addWorker, addAgent, skills } = useBuilderStore()

  const agents = nodes.map((n) => {
    const d = n.data as AgentNodeData
    return { id: n.id, name: d.name, role: d.role, color: d.color }
  })

  if (nodes.length === 0) {
    return (
      <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Agents</h4>
        <p className="text-[11px] text-[var(--tx3)] mb-3">Add an Orchestrator to begin.</p>
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
            <div
              key={agent.id}
              onClick={() => selectAgent(agent.id)}
              className={cn(
                "flex items-center gap-1.5 py-1.5 px-2 rounded-[6px] cursor-pointer transition-colors",
                isSelected && "bg-[var(--bg3)] text-[var(--tx)] font-semibold",
                !isSelected && "hover:bg-[var(--bg2)]",
                isOrch && "bg-[var(--acbg)] text-[var(--ac)] border-l-[3px] border-l-[var(--ac)] font-semibold",
                isCritic && "border-l-[3px] border-l-[#8b5cf6] font-semibold"
              )}
            >
              <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ backgroundColor: agent.color }} />
              <span className="truncate">{agent.name}</span>
            </div>
          )
        })}
      </div>

      <Button variant="outline" size="sm" className="w-full mt-2 text-[10px]" onClick={addWorker}>
        + Add worker
      </Button>

      <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2 mt-4">Skills</h4>

      <div className="space-y-[3px]">
        {skills.map((skill) => (
          <div key={skill.id} className="flex items-center gap-1.5 py-1.5 px-2 rounded-[6px] text-[11px] text-[var(--tx2)]">
            <span className="flex items-center">{CATEGORY_ICONS[skill.category] || DEFAULT_SKILL_ICON}</span>
            <span className="truncate">{skill.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
