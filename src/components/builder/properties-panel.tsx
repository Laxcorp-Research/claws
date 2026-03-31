"use client"

import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import { MarkdownEditor } from "./markdown-editor"
import { SkillPicker } from "./skill-picker"
import { CustomSelect } from "./custom-select"
import { AI_MODELS } from "@/lib/models"

const MODEL_OPTIONS = AI_MODELS.map(m => ({ value: m.value, label: m.label }))

export function PropertiesPanel() {
  const { nodes, selectedAgentId, updateAgentProperty, deleteAgent } = useBuilderStore()

  const selectedNode = nodes.find((n) => n.id === selectedAgentId)

  if (!selectedNode) {
    return (
      <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Workspace</h4>
        <p className="text-[11px] text-[var(--tx2)]">Select an agent on the canvas or sidebar to edit its properties.</p>
      </div>
    )
  }

  const agent = selectedNode.data as AgentNodeData
  const isOrch = agent.role === "ORCHESTRATOR"
  const isCritic = agent.role === "CRITIC"
  const canDelete = !isOrch && !isCritic
  const otherAgents = nodes.filter((n) => n.id !== selectedAgentId)

  const agentOptions = [
    { value: "", label: "None" },
    ...otherAgents.map((n) => ({ value: n.id, label: (n.data as AgentNodeData).name })),
  ]

  return (
    <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
      <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">
        Properties — {agent.name}
      </h4>

      {/* Role */}
      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Role</label>
        <span className={cn(
          "inline-block text-[10px] font-semibold px-2 py-[2px] rounded-[6px]",
          isOrch && "bg-[var(--acbg)] text-[var(--ac)]",
          isCritic && "bg-[#ede9fe] text-[#5b21b6]",
          !isOrch && !isCritic && "bg-[var(--bg2)] text-[var(--tx2)]"
        )}>
          {agent.role}
        </span>
      </div>

      {/* Name */}
      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Name</label>
        <input
          type="text"
          value={agent.name}
          onChange={(e) => updateAgentProperty(selectedAgentId!, "name", e.target.value)}
          className="w-full px-2 py-[5px] border border-[var(--bd)] rounded-[6px] text-[11px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
        />
      </div>

      {/* Model */}
      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Model</label>
        <CustomSelect
          value={agent.model}
          onChange={(val) => updateAgentProperty(selectedAgentId!, "model", val)}
          options={MODEL_OPTIONS}
        />
      </div>

      {/* SOUL.md */}
      <MarkdownEditor
        label="SOUL.md"
        value={agent.soulMd || ""}
        onChange={(val) => updateAgentProperty(selectedAgentId!, "soulMd", val)}
        placeholder="Agent identity and personality..."
      />

      {/* AGENTS.md */}
      <MarkdownEditor
        label="AGENTS.md"
        value={agent.agentsMd || ""}
        onChange={(val) => updateAgentProperty(selectedAgentId!, "agentsMd", val)}
        placeholder="Operating procedures..."
      />

      {/* Skills */}
      <SkillPicker agentId={selectedAgentId!} />

      {/* Reports To */}
      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Reports to</label>
        <CustomSelect
          value={agent.reportsTo || ""}
          onChange={(val) => updateAgentProperty(selectedAgentId!, "reportsTo", val || undefined)}
          options={agentOptions}
        />
      </div>

      {/* Outputs To */}
      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Outputs to</label>
        <CustomSelect
          value={(agent.outputsTo as string) || ""}
          onChange={(val) => updateAgentProperty(selectedAgentId!, "outputsTo", val || undefined)}
          options={agentOptions}
        />
      </div>

      {/* Critic: Quality Threshold */}
      {isCritic && (
        <div className="mb-2.5">
          <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">
            Quality threshold: {agent.qualityThreshold ?? 8.0}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={agent.qualityThreshold ?? 8.0}
            onChange={(e) => updateAgentProperty(selectedAgentId!, "qualityThreshold", parseFloat(e.target.value))}
            className="w-full h-1.5 accent-[var(--tx)]"
          />
          <div className="flex justify-between text-[9px] text-[var(--tx3)]">
            <span>1 (lenient)</span>
            <span>10 (strict)</span>
          </div>
        </div>
      )}

      {/* Delete (workers only) */}
      {canDelete && (
        <button
          onClick={() => deleteAgent(selectedAgentId!)}
          className="w-full mt-3 py-1.5 text-[10px] text-[var(--err)] border border-[var(--err)] rounded-[6px] hover:bg-[var(--errbg)] transition-colors cursor-pointer bg-transparent"
        >
          Remove agent
        </button>
      )}
    </div>
  )
}
