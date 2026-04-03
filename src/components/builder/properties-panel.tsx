"use client"

import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData, type ConnectionEdgeData } from "@/stores/builder-store"
import { MarkdownEditor } from "./markdown-editor"
import { SkillPicker } from "./skill-picker"
import { CustomSelect } from "./custom-select"
import { HelpTooltip } from "@/components/ui/help-tooltip"
import { AI_MODELS } from "@/lib/models"

const MODEL_OPTIONS = AI_MODELS.map(m => ({ value: m.value, label: m.label }))

const CONDITION_OPTIONS = [
  { value: "ON_COMPLETE", label: "On complete" },
  { value: "ON_APPROVAL", label: "On approval" },
  { value: "ON_REJECTION", label: "On rejection" },
  { value: "ON_SCHEDULE", label: "On schedule" },
  { value: "ON_HUMAN_APPROVE", label: "On human approval" },
]

function Label({ text, tooltip }: { text: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-[4px] mb-[3px]">
      <label className="text-[10px] text-[var(--tx2)] font-medium">{text}</label>
      <HelpTooltip text={tooltip} />
    </div>
  )
}

function ConnectionPanel() {
  const { nodes, edges, selectedEdgeId, updateConnectionCondition, removeConnection } = useBuilderStore()

  const edge = edges.find(e => e.id === selectedEdgeId)
  if (!edge) return null

  const sourceNode = nodes.find(n => n.id === edge.source)
  const targetNode = nodes.find(n => n.id === edge.target)
  const sourceName = (sourceNode?.data as AgentNodeData)?.name || "Unknown"
  const targetName = (targetNode?.data as AgentNodeData)?.name || "Unknown"
  const condition = (edge.data as ConnectionEdgeData)?.condition || "ON_COMPLETE"

  return (
    <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
      <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Connection</h4>

      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">From</label>
        <div className="text-[11px] text-[var(--tx)] px-[8px] py-[5px] bg-[var(--bg2)] rounded-[6px]">{sourceName}</div>
      </div>

      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">To</label>
        <div className="text-[11px] text-[var(--tx)] px-[8px] py-[5px] bg-[var(--bg2)] rounded-[6px]">{targetName}</div>
      </div>

      <div className="mb-2.5">
        <Label text="Condition" tooltip="When this connection activates. 'On complete' fires after the source agent finishes. 'On human approval' waits for a human to approve first." />
        <CustomSelect
          value={condition}
          onChange={(val) => updateConnectionCondition(selectedEdgeId!, val)}
          options={CONDITION_OPTIONS}
        />
      </div>

      <button
        onClick={() => removeConnection(selectedEdgeId!)}
        className="w-full mt-3 py-1.5 text-[10px] text-[var(--err)] border border-[var(--err)] rounded-[6px] hover:bg-[var(--errbg)] transition-colors cursor-pointer bg-transparent"
      >
        Remove connection
      </button>
    </div>
  )
}

export function PropertiesPanel() {
  const { nodes, edges, selectedAgentId, selectedEdgeId, updateAgentProperty, deleteAgent, addConnection, removeConnection: removeConn, updateConnection } = useBuilderStore()

  if (selectedEdgeId) {
    return <ConnectionPanel />
  }

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

  const incomingEdge = edges.find(e => e.target === selectedAgentId)
  const outgoingEdge = edges.find(e => e.source === selectedAgentId)

  function roleFilteredOptions(filter: (r: string) => boolean, currentValue?: string) {
    const filtered = otherAgents.filter(n => filter((n.data as AgentNodeData).role))
    const options = [
      { value: "", label: "None" },
      ...filtered.map(n => ({ value: n.id, label: (n.data as AgentNodeData).name })),
    ]
    if (currentValue && !options.some(o => o.value === currentValue)) {
      const staleNode = nodes.find(n => n.id === currentValue)
      const staleName = staleNode ? (staleNode.data as AgentNodeData).name : "Unknown"
      options.push({ value: currentValue, label: staleName })
    }
    return options
  }

  const reportsToOptions = roleFilteredOptions(
    r => r === "ORCHESTRATOR" || r === "WORKER",
    incomingEdge?.source
  )
  const outputsToOptions = isOrch
    ? roleFilteredOptions(r => r === "WORKER", outgoingEdge?.target)
    : isCritic
      ? roleFilteredOptions(r => r === "ORCHESTRATOR" || r === "WORKER", outgoingEdge?.target)
      : roleFilteredOptions(r => r === "CRITIC" || r === "WORKER", outgoingEdge?.target)

  function handleReportsToChange(newParentId: string) {
    if (!selectedAgentId) return
    if (newParentId === selectedAgentId) return

    if (!newParentId) {
      if (incomingEdge) removeConn(incomingEdge.id)
    } else if (incomingEdge) {
      updateConnection(incomingEdge.id, { source: newParentId })
    } else {
      addConnection({ source: newParentId, target: selectedAgentId })
    }
    updateAgentProperty(selectedAgentId, "reportsTo", newParentId || undefined)
  }

  function handleOutputsToChange(newTargetId: string) {
    if (!selectedAgentId) return
    if (newTargetId === selectedAgentId) return

    if (!newTargetId) {
      if (outgoingEdge) removeConn(outgoingEdge.id)
    } else if (outgoingEdge) {
      updateConnection(outgoingEdge.id, { target: newTargetId })
    } else {
      addConnection({ source: selectedAgentId, target: newTargetId })
    }
    updateAgentProperty(selectedAgentId, "outputsTo", newTargetId || undefined)
  }

  return (
    <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
      <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">
        Properties - {agent.name}
      </h4>

      <div className="mb-2.5">
        <Label text="Role" tooltip="Orchestrator coordinates all agents. Workers execute tasks. Critic reviews quality." />
        <span className={cn(
          "inline-block text-[10px] font-semibold px-2 py-[2px] rounded-[6px]",
          isOrch && "bg-[var(--acbg)] text-[var(--ac)]",
          isCritic && "bg-[#ede9fe] text-[#5b21b6]",
          !isOrch && !isCritic && "bg-[var(--bg2)] text-[var(--tx2)]"
        )}>
          {agent.role}
        </span>
      </div>

      <div className="mb-2.5">
        <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Name</label>
        <input
          type="text"
          value={agent.name}
          onChange={(e) => updateAgentProperty(selectedAgentId!, "name", e.target.value)}
          className="w-full px-2 py-[5px] border border-[var(--bd)] rounded-[6px] text-[11px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
        />
      </div>

      <div className="mb-2.5">
        <Label text="Model" tooltip="The AI model this agent uses. Haiku is fast and cheap. Sonnet balances speed and quality. Opus is most capable but costs more." />
        <CustomSelect
          value={agent.model}
          onChange={(val) => updateAgentProperty(selectedAgentId!, "model", val)}
          options={MODEL_OPTIONS}
        />
      </div>

      <MarkdownEditor
        label="SOUL.md"
        tooltip="Defines who this agent is - its identity, personality, and core purpose. Think of it as the agent's character sheet."
        value={agent.soulMd || ""}
        onChange={(val) => updateAgentProperty(selectedAgentId!, "soulMd", val)}
        placeholder="Agent identity and personality..."
      />

      <MarkdownEditor
        label="AGENTS.md"
        tooltip="Step-by-step operating procedures this agent follows. Like a detailed SOP - what to do, in what order, with what tools."
        value={agent.agentsMd || ""}
        onChange={(val) => updateAgentProperty(selectedAgentId!, "agentsMd", val)}
        placeholder="Operating procedures..."
      />

      <div className="mb-2.5">
        <Label text="Skills" tooltip="Tools and capabilities available to this agent. Each skill gives the agent instructions for using a specific tool." />
        <SkillPicker agentId={selectedAgentId!} />
      </div>

      <div className="mb-2.5">
        {isOrch ? (
          <>
            <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Reports to</label>
            <p className="text-[11px] text-[var(--tx3)] italic">None - top of hierarchy</p>
          </>
        ) : isCritic ? (
          <>
            <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Receives from</label>
            <p className="text-[11px] text-[var(--tx3)] italic">All workers (via their output settings)</p>
          </>
        ) : (
          <>
            <Label text="Reports to" tooltip="Which agent this one reports its work to. Typically Workers report to the Orchestrator." />
            <CustomSelect
              value={incomingEdge?.source || ""}
              onChange={(val) => handleReportsToChange(val)}
              options={reportsToOptions}
            />
          </>
        )}
      </div>

      <div className="mb-2.5">
        <Label text="Outputs to" tooltip="Where this agent sends its completed work. Usually the Critic for review, or another Worker for the next step." />
        <CustomSelect
          value={outgoingEdge?.target || ""}
          onChange={(val) => handleOutputsToChange(val)}
          options={outputsToOptions}
        />
      </div>

      {isCritic && (
        <div className="mb-2.5">
          <Label text={`Quality threshold: ${agent.qualityThreshold ?? 8.0}`} tooltip="Minimum score (1-10) for work to be approved. Below this, the Critic sends it back for revision. Default 8.0 works well for most cases." />
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
