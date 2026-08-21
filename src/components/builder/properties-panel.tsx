"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { useBuilderStore, type AgentNodeData, type ConnectionEdgeData } from "@/stores/builder-store"
import { MarkdownEditor } from "./markdown-editor"
import { SkillPicker } from "./skill-picker"
import { CustomSelect } from "./custom-select"
import { HelpTooltip } from "@/components/ui/help-tooltip"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { ModelPicker } from "@/components/shared/model-picker"
import { useCreditBalance } from "@/hooks/use-credit-balance"
import { isCreditAuthPath, validConfiguredProviders } from "@/lib/models/provider-auth"
import { BYOK_COST_DISCLAIMER, shouldShowByokCostDisclaimer } from "@/lib/models/byok-disclaimer"
import {
  CONTEXT_NOTE_MAX_CHARS,
  WORKFLOW_FENCE_BEGIN,
  WORKFLOW_FENCE_END,
  formatWorkflowLawSection,
  normalizeContextNote,
} from "@/lib/openclaw/workflow-language"
import {
  AUTO_PROCEED_DISABLED_COPY,
} from "@/lib/openclaw/validate-topology"
import {
  REGULATED_QUALITY_THRESHOLD_FLOOR,
  isRegulatedTemplateSlug,
} from "@/lib/openclaw/regulated-threshold-floor"
import { deriveReportsToMap } from "@/lib/openclaw/derive-reports-to"

function Label({ text, tooltip }: { text: string; tooltip: string }) {
  return (
    <div className="flex items-center gap-[4px] mb-[3px]">
      <label className="text-[10px] text-[var(--tx2)] font-medium">{text}</label>
      <HelpTooltip text={tooltip} />
    </div>
  )
}

function splitFence(agentsMd: string): { before: string; fence: string | null; after: string } {
  const begin = agentsMd.indexOf(WORKFLOW_FENCE_BEGIN)
  const end = agentsMd.indexOf(WORKFLOW_FENCE_END)
  if (begin === -1 || end === -1 || end < begin) {
    return { before: agentsMd, fence: null, after: "" }
  }
  const afterEnd = end + WORKFLOW_FENCE_END.length
  return {
    before: agentsMd.slice(0, begin),
    fence: agentsMd.slice(begin, afterEnd),
    after: agentsMd.slice(afterEnd),
  }
}

function ConnectionPanel() {
  const { nodes, edges, selectedEdgeId, updateConnectionContextNote, removeConnection } = useBuilderStore()

  const edge = edges.find(e => e.id === selectedEdgeId)
  if (!edge) return null

  const sourceNode = nodes.find(n => n.id === edge.source)
  const targetNode = nodes.find(n => n.id === edge.target)
  const sourceName = (sourceNode?.data as AgentNodeData)?.name || "Unknown"
  const targetName = (targetNode?.data as AgentNodeData)?.name || "Unknown"
  const note = (edge.data as ConnectionEdgeData)?.contextNote ?? ""

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
        <Label
          text={`Note (${(note || "").length}/${CONTEXT_NOTE_MAX_CHARS})`}
          tooltip="Optional hint woven into the Commander's Workflow sentence for this worker. Conditions are not used — every solid edge is an unconditional handoff."
        />
        <textarea
          value={note || ""}
          maxLength={CONTEXT_NOTE_MAX_CHARS}
          onChange={(e) => updateConnectionContextNote(selectedEdgeId!, e.target.value)}
          rows={3}
          placeholder="Optional context for this handoff…"
          className="w-full px-2 py-[5px] border border-[var(--bd)] rounded-[6px] text-[11px] bg-[var(--bg)] text-[var(--tx)] focus:outline-none focus:border-[var(--tx)] resize-y"
        />
        {normalizeContextNote(note) && (
          <p className="mt-1.5 text-[10px] text-[var(--tx3)] italic">
            Preview: Delegate work to {targetName} ({normalizeContextNote(note)}).
          </p>
        )}
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

function WorkflowKnobsPanel() {
  const {
    nodes,
    maxRevisionRounds,
    deliveryMode,
    templateSlug,
    setMaxRevisionRounds,
    setDeliveryMode,
    updateAgentProperty,
    focusWorkflowKnobs,
    clearFocusWorkflowKnobs,
  } = useBuilderStore()

  const critic = nodes.find((n) => (n.data as AgentNodeData).role === "CRITIC")
  const orch = nodes.find((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")
  const criticData = critic?.data as AgentNodeData | undefined
  const orchData = orch?.data as AgentNodeData | undefined
  const regulated = isRegulatedTemplateSlug(templateSlug)
  const thresholdMin = regulated ? REGULATED_QUALITY_THRESHOLD_FLOOR : 1
  const threshold = Math.max(thresholdMin, criticData?.qualityThreshold ?? 8)

  useEffect(() => {
    if (focusWorkflowKnobs) {
      clearFocusWorkflowKnobs()
    }
  }, [focusWorkflowKnobs, clearFocusWorkflowKnobs])

  const lawPreview = useMemo(
    () =>
      formatWorkflowLawSection({
        orchestratorDisplayName: orchData?.name || "Commander",
        criticDisplayName: criticData?.name || "Quality Critic",
        qualityThreshold: threshold,
        maxRevisionRounds,
        deliveryMode,
      }),
    [orchData?.name, criticData?.name, threshold, maxRevisionRounds, deliveryMode],
  )

  return (
    <div
      className={cn(
        "mb-2.5 rounded-[6px] border border-[var(--bd)] p-2",
        focusWorkflowKnobs && "ring-1 ring-[var(--ac)]",
      )}
      data-testid="workflow-knobs-panel"
    >
      <h5 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">
        Workflow settings
      </h5>

      {critic && (
        <div className="mb-2.5">
          <Label
            text={`Quality threshold: ${threshold}`}
            tooltip="Minimum score (1–10) for work to be approved. Below this, the Critic sends it back for revision."
          />
          <input
            type="range"
            min={thresholdMin}
            max={10}
            step={0.5}
            value={threshold}
            onChange={(e) =>
              updateAgentProperty(critic.id, "qualityThreshold", parseFloat(e.target.value))
            }
            className="w-full h-1.5 accent-[var(--tx)]"
          />
          <div className="flex justify-between text-[9px] text-[var(--tx3)]">
            <span>{regulated ? `${thresholdMin} (floor)` : "1 (lenient)"}</span>
            <span>10 (strict)</span>
          </div>
          {regulated && (
            <p className="mt-1 text-[9px] text-[var(--tx3)]">
              Lenient scores are hidden for this regulated template (floor {REGULATED_QUALITY_THRESHOLD_FLOOR}).
            </p>
          )}
        </div>
      )}

      <div className="mb-2.5">
        <Label
          text={`Revision rounds: ${maxRevisionRounds}`}
          tooltip="How many times rejected work can loop back before the Commander presents the best attempt."
        />
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={maxRevisionRounds}
          onChange={(e) => setMaxRevisionRounds(parseInt(e.target.value, 10))}
          className="w-full h-1.5 accent-[var(--tx)]"
        />
      </div>

      <div className="mb-2.5">
        <Label text="Delivery mode" tooltip="Whether the Commander asks you before acting on approved work." />
        <CustomSelect
          value={deliveryMode}
          onChange={(val) => {
            if (val === "AUTO_PROCEED") return
            setDeliveryMode("APPROVAL_REQUIRED")
          }}
          options={[
            { value: "APPROVAL_REQUIRED", label: "Ask before acting" },
            { value: "AUTO_PROCEED", label: "Autonomous (unavailable)" },
          ]}
        />
        <p className="mt-1 text-[9px] text-[var(--tx3)]">{AUTO_PROCEED_DISABLED_COPY}</p>
      </div>

      <div className="rounded-[6px] bg-[var(--bg2)] px-2 py-1.5 text-[10px] text-[var(--tx2)] leading-snug">
        <span className="font-medium text-[var(--tx)]">Live law preview: </span>
        {lawPreview}
      </div>
    </div>
  )
}

export function PropertiesPanel() {
  const {
    nodes,
    edges,
    selectedAgentId,
    selectedEdgeId,
    updateAgent,
    updateAgentProperty,
    deleteAgent,
    jumpToWorkflowKnobs,
  } = useBuilderStore()
  const workspaceId = useBuilderStore((s) => s.workspaceId)
  const credit = useCreditBalance()
  const creditMode = isCreditAuthPath(credit)
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])
  const snackbar = useSnackbarOptional()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    void fetch(`/api/workspaces/${workspaceId}/api-keys`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: Parameters<typeof validConfiguredProviders>[0] }) => {
        if (cancelled || !json.success || !Array.isArray(json.data)) return
        setConfiguredProviders(validConfiguredProviders(json.data))
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const reportsToMap = useMemo(
    () =>
      deriveReportsToMap({
        agents: nodes.map((n) => ({
          id: n.id,
          role: (n.data as AgentNodeData).role,
        })),
        edges: edges.map((e) => ({
          sourceAgentId: e.source,
          targetAgentId: e.target,
        })),
      }),
    [nodes, edges],
  )

  if (selectedEdgeId) {
    return <ConnectionPanel />
  }

  const selectedNode = nodes.find((n) => n.id === selectedAgentId)

  if (!selectedNode) {
    return (
      <div className="border border-[var(--bd)] rounded-lg p-2.5 overflow-y-auto text-[11px]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider mb-2">Workspace</h4>
        <p className="text-[11px] text-[var(--tx2)] mb-2.5">
          Select an agent on the canvas or sidebar to edit its properties.
        </p>
        <WorkflowKnobsPanel />
      </div>
    )
  }

  const agent = selectedNode.data as AgentNodeData
  const isOrch = agent.role === "ORCHESTRATOR"
  const isCritic = agent.role === "CRITIC"
  const canDelete = !isOrch && !isCritic
  const connectionCount = edges.filter(
    (e) => e.source === selectedAgentId || e.target === selectedAgentId,
  ).length

  const projectedReportsTo = selectedAgentId
    ? reportsToMap.get(selectedAgentId) ?? null
    : null
  const reportsToName = projectedReportsTo
    ? (nodes.find((n) => n.id === projectedReportsTo)?.data as AgentNodeData | undefined)?.name
    : null

  const fenceParts = isOrch ? splitFence(agent.agentsMd || "") : null

  function handleDeleteConfirm() {
    if (!selectedAgentId) return
    setDeleting(true)
    void mutateWithFeedback(
      async () => {
        deleteAgent(selectedAgentId)
        setDeleteConfirmOpen(false)
      },
      { message: "Agent removed", errorMessage: "Could not remove agent" },
      (opts) => snackbar?.show(opts),
    ).finally(() => setDeleting(false))
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
          isOrch && "bg-[var(--acbg)] text-[var(--ac-text)]",
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
        <Label text="Model" tooltip="The AI model this agent uses. Click to open the model catalog: pick a provider, a model, and the thinking effort." />
        <ModelPicker
          value={agent.model}
          thinkingDefault={agent.thinkingDefault ?? null}
          onChange={(model, thinking) =>
            updateAgent(selectedAgentId!, { model, thinkingDefault: thinking })
          }
          creditMode={creditMode}
          configuredProviders={configuredProviders}
          agentName={agent.name}
        />
        {shouldShowByokCostDisclaimer({
          creditMode,
          configuredProviders,
          selectedModels: [agent.model],
        }) && (
          <p data-testid="byok-cost-disclaimer" className="text-[10px] text-[var(--tx3)] mt-[6px]">
            {BYOK_COST_DISCLAIMER}
          </p>
        )}
      </div>

      <MarkdownEditor
        label="SOUL.md"
        tooltip="Defines who this agent is - its identity, personality, and core purpose. Think of it as the agent's character sheet."
        value={agent.soulMd || ""}
        onChange={(val) => updateAgentProperty(selectedAgentId!, "soulMd", val)}
        placeholder="Agent identity and personality..."
      />

      {isOrch && fenceParts ? (
        <>
          <MarkdownEditor
            label="AGENTS.md (procedures)"
            tooltip="Operating procedures outside the Workflow fence. The fenced Workflow block is generated from the canvas and knobs — edit those instead."
            value={fenceParts.before + fenceParts.after}
            onChange={(val) => {
              // Preserve existing fence (if any) between prose edits.
              const next = fenceParts.fence
                ? `${val.trimEnd()}\n\n${fenceParts.fence}\n`
                : val
              updateAgentProperty(selectedAgentId!, "agentsMd", next)
            }}
            placeholder="Operating procedures..."
          />
          <div
            className="mb-2.5 rounded-[6px] border border-[var(--bd)] bg-[var(--bg2)] p-2 cursor-default select-none"
            data-testid="workflow-fence-card"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">
                Workflow (locked)
              </span>
              <button
                type="button"
                onClick={() => jumpToWorkflowKnobs()}
                className="text-[10px] text-[var(--ac-text)] underline bg-transparent border-0 cursor-pointer p-0"
              >
                Jump to settings
              </button>
            </div>
            <p className="text-[10px] text-[var(--tx3)] mb-1.5">
              Regenerated on deploy from canvas edges + knobs. Cursor entry disabled.
            </p>
            <pre className="whitespace-pre-wrap text-[10px] text-[var(--tx2)] font-mono max-h-[140px] overflow-y-auto">
              {fenceParts.fence || "(Will be generated on deploy from your connections.)"}
            </pre>
          </div>
        </>
      ) : (
        <MarkdownEditor
          label="AGENTS.md"
          tooltip="Step-by-step operating procedures this agent follows. Like a detailed SOP - what to do, in what order, with what tools."
          value={agent.agentsMd || ""}
          onChange={(val) => updateAgentProperty(selectedAgentId!, "agentsMd", val)}
          placeholder="Operating procedures..."
        />
      )}

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
            <p className="text-[11px] text-[var(--tx3)] italic">All workers automatically (review is not a drawn edge)</p>
          </>
        ) : (
          <>
            <Label text="Reports to" tooltip="Projected from your Commander → Worker edge. Read-only." />
            <p className="text-[11px] text-[var(--tx)] px-[8px] py-[5px] bg-[var(--bg2)] rounded-[6px]">
              {reportsToName || "Not connected — draw an edge from the Commander"}
            </p>
          </>
        )}
      </div>

      {(isOrch || isCritic) && <WorkflowKnobsPanel />}

      {canDelete && (
        <>
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            className="w-full mt-3 py-1.5 text-[10px] text-[var(--err)] border border-[var(--err)] rounded-[6px] hover:bg-[var(--errbg)] transition-colors cursor-pointer bg-transparent"
          >
            Remove agent
          </button>
          <ConfirmDialog
            open={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            onConfirm={handleDeleteConfirm}
            title={`Remove ${agent.name}?`}
            description={`This removes ${agent.name} and ${connectionCount} connection${connectionCount === 1 ? "" : "s"}. There is no undo — restore from Version History if needed.`}
            confirmLabel="Remove agent"
            cancelLabel="Cancel"
            loading={deleting}
          />
        </>
      )}
    </div>
  )
}
