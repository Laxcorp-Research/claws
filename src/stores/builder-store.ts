import { create } from "zustand"
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  Connection,
} from "@xyflow/react"
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react"
import { DEFAULT_MODEL } from "@/lib/models"
import { resolvePickerHeartbeatSchedule } from "@/lib/builder/heartbeat-picker"
import { deserializeSchedule, serializeSchedule, validateSchedule } from "@/lib/schedule"
import { evaluateConnectAttempt } from "@/lib/openclaw/builder-topology"
import type { ConnectAttemptResult } from "@/lib/openclaw/builder-topology"

export type HeartbeatScheduleState = {
  frequency: string
  time: string
}

export type AgentRole = "ORCHESTRATOR" | "WORKER" | "CRITIC"

export type ConnectionCondition =
  | "ON_COMPLETE"
  | "ON_APPROVAL"
  | "ON_REJECTION"
  | "ON_SCHEDULE"
  | "ON_HUMAN_APPROVE"

export interface AgentNodeData extends Record<string, unknown> {
  agentId: string
  name: string
  role: AgentRole
  color: string
  model: string
  /** OpenClaw thinking level (off|minimal|low|medium|high); null = runtime default. */
  thinkingDefault?: string | null
  soulMd: string
  agentsMd: string
  skillCount: number
  agentSkillIds: string[]
  hasHeartbeat: boolean
  healthStatus: "healthy" | "idle" | "error"
  qualityThreshold?: number
  reportsTo?: string
  outputsTo?: string
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  condition: ConnectionCondition
  label: string
  /** Optional ≤140-char note woven into the Workflow delegation sentence. */
  contextNote?: string | null
}

export type DeliveryModeUi = "APPROVAL_REQUIRED" | "AUTO_PROCEED"

export interface SkillItem {
  id: string
  name: string
  slug: string
  category: string
  description: string
}

export interface SnapshotItem {
  id: string
  version: number
  trigger: string
  label: string | null
  createdAt: string
}

interface SavedState {
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
  workspaceName: string
  skills: SkillItem[]
  heartbeatSchedule: HeartbeatScheduleState
  maxRevisionRounds: number
  deliveryMode: DeliveryModeUi
}

interface BuilderState {
  workspaceId: string | null
  workspaceName: string
  workspaceStatus: string
  /** IANA tz from workspace row — used to render/preview schedule fires. */
  workspaceTimezone: string
  /** ClawTemplate slug when installed from marketplace — drives regulated floor UI. */
  templateSlug: string | null
  maxRevisionRounds: number
  deliveryMode: DeliveryModeUi
  isLoading: boolean
  loadError: number | null

  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]

  selectedAgentId: string | null
  selectedEdgeId: string | null
  /** Focus choreography knobs (from locked fence jump link). */
  focusWorkflowKnobs: boolean
  leftPanelTab: "agents" | "skills"

  skills: SkillItem[]
  heartbeatSchedule: HeartbeatScheduleState

  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  lastSavedState: SavedState | null

  hasDraftRecovery: boolean
  draftTimestamp: number | null
  _draftIntervalId: ReturnType<typeof setInterval> | null

  snapshots: SnapshotItem[]
  isLoadingSnapshots: boolean

  onNodesChange: OnNodesChange<Node<AgentNodeData>>
  onEdgesChange: OnEdgesChange<Edge<ConnectionEdgeData>>
  onConnect: OnConnect
  /** Draw-time / panel connect with toastable rejection reason. */
  tryConnect: (connection: Connection) => ConnectAttemptResult

  setWorkspace: (id: string, name: string, status: string) => void
  setWorkspaceName: (name: string) => void
  setMaxRevisionRounds: (rounds: number) => void
  setDeliveryMode: (mode: DeliveryModeUi) => void
  setLeftPanelTab: (tab: "agents" | "skills") => void
  selectAgent: (id: string | null) => void
  selectEdge: (id: string | null) => void
  jumpToWorkflowKnobs: () => void
  clearFocusWorkflowKnobs: () => void
  addAgent: (opts?: { name?: string; role?: AgentRole; model?: string; soulMd?: string; agentsMd?: string }) => void
  addWorker: () => void
  removeAgent: (id: string) => void
  deleteAgent: (id: string) => void
  updateAgent: (id: string, updates: Partial<AgentNodeData>) => void
  updateAgentProperty: (id: string, key: string, value: unknown) => void
  toggleSkill: (agentId: string, skillId: string) => void
  setHeartbeatSchedule: (schedule: Partial<HeartbeatScheduleState>) => void
  addConnection: (data: { source: string; target: string; condition?: string }) => ConnectAttemptResult
  removeConnection: (id: string) => void
  updateConnection: (edgeId: string, updates: { source?: string; target?: string }) => void
  updateConnectionContextNote: (edgeId: string, contextNote: string) => void
  addSkill: (skill: SkillItem) => void
  revertToLastSaved: () => void
  loadFromSnapshot: (nodes: Node<AgentNodeData>[], edges: Edge<ConnectionEdgeData>[]) => void
  markDirty: () => void
  markSaved: () => void

  restoreDraft: () => void
  dismissDraft: () => void

  loadWorkspace: (workspaceId: string) => Promise<void>
  saveWorkspace: () => Promise<void>
  loadSnapshots: () => Promise<void>
  restoreSnapshot: (snapshotId: string) => Promise<void>
}

const WORKER_COLORS = ["#8BFCAE", "#5BA1F5", "#FFB1AB", "#FFDC6E", "#FFB1AB", "#8BFCAE"]

function getDefaultPosition(role: AgentRole, existingNodes: Node[]): { x: number; y: number } {
  const workerCount = existingNodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
  switch (role) {
    case "ORCHESTRATOR": return { x: 300, y: 40 }
    case "CRITIC": return { x: 300, y: 400 }
    case "WORKER": return { x: 80 + workerCount * 160, y: 220 }
  }
}

function cloneState(
  nodes: Node<AgentNodeData>[],
  edges: Edge<ConnectionEdgeData>[],
  name: string,
  skills: SkillItem[] = [],
  heartbeatSchedule: HeartbeatScheduleState = { frequency: "off", time: "08:00" },
  maxRevisionRounds = 3,
  deliveryMode: DeliveryModeUi = "APPROVAL_REQUIRED",
): SavedState {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
    workspaceName: name,
    skills: JSON.parse(JSON.stringify(skills)),
    heartbeatSchedule: { ...heartbeatSchedule },
    maxRevisionRounds,
    deliveryMode,
  }
}

function computeIsDirty(state: {
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
  workspaceName: string
  skills: SkillItem[]
  heartbeatSchedule: HeartbeatScheduleState
  maxRevisionRounds: number
  deliveryMode: DeliveryModeUi
  lastSavedState: SavedState | null
}): boolean {
  if (!state.lastSavedState) {
    return state.nodes.some(n => n.id.startsWith("temp-"))
  }
  const ss = state.lastSavedState

  if (state.workspaceName !== ss.workspaceName) return true
  if (state.maxRevisionRounds !== (ss.maxRevisionRounds ?? 3)) return true
  if (state.deliveryMode !== (ss.deliveryMode ?? "APPROVAL_REQUIRED")) return true
  if (state.nodes.length !== ss.nodes.length) return true
  if (state.edges.length !== ss.edges.length) return true
  if (state.skills.length !== (ss.skills?.length || 0)) return true
  const savedHb = ss.heartbeatSchedule || { frequency: "off", time: "08:00" }
  if (state.heartbeatSchedule.frequency !== savedHb.frequency) return true
  if (state.heartbeatSchedule.time !== savedHb.time) return true

  for (const node of state.nodes) {
    const saved = ss.nodes.find(n => n.id === node.id)
    if (!saved) return true
    const d = node.data as AgentNodeData
    const sd = saved.data as AgentNodeData
    if (d.name !== sd.name || d.model !== sd.model || d.role !== sd.role) return true
    if ((d.thinkingDefault ?? null) !== (sd.thinkingDefault ?? null)) return true
    if (d.soulMd !== sd.soulMd || d.agentsMd !== sd.agentsMd) return true
    if (d.reportsTo !== sd.reportsTo || d.outputsTo !== sd.outputsTo || d.qualityThreshold !== sd.qualityThreshold) return true
    if (JSON.stringify(d.agentSkillIds || []) !== JSON.stringify(sd.agentSkillIds || [])) return true
    if (Math.round(node.position.x) !== Math.round(saved.position.x)) return true
    if (Math.round(node.position.y) !== Math.round(saved.position.y)) return true
  }

  for (const saved of ss.nodes) {
    if (!state.nodes.find(n => n.id === saved.id)) return true
  }

  for (const edge of state.edges) {
    const saved = ss.edges.find(e => e.id === edge.id)
    if (!saved) return true
    if (edge.source !== saved.source || edge.target !== saved.target) return true
    const ed = edge.data as ConnectionEdgeData
    const sd = saved.data as ConnectionEdgeData
    if ((ed?.contextNote ?? null) !== (sd?.contextNote ?? null)) return true
  }

  for (const saved of ss.edges) {
    if (!state.edges.find(e => e.id === saved.id)) return true
  }

  return false
}

function draftKey(workspaceId: string) {
  return `claws-draft-${workspaceId}`
}

interface DraftState {
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
  workspaceName: string
  skills: SkillItem[]
  heartbeatSchedule?: HeartbeatScheduleState
  timestamp: number
}

function saveDraftToLocal(workspaceId: string, state: DraftState) {
  try { localStorage.setItem(draftKey(workspaceId), JSON.stringify(state)) } catch { /* full or unavailable */ }
}

function loadDraftFromLocal(workspaceId: string): DraftState | null {
  try {
    const raw = localStorage.getItem(draftKey(workspaceId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function clearDraftFromLocal(workspaceId: string) {
  try { localStorage.removeItem(draftKey(workspaceId)) } catch { /* noop */ }
}

export const useBuilderStore = create<BuilderState>((set, get) => {
  function recheckDirty() {
    const s = get()
    if (s.isSaving) return
    const dirty = computeIsDirty(s)
    if (dirty !== s.isDirty) set({ isDirty: dirty })
  }

  return {
    workspaceId: null,
    workspaceName: "",
    workspaceStatus: "DRAFT",
    workspaceTimezone: "UTC",
    templateSlug: null,
    maxRevisionRounds: 3,
    deliveryMode: "APPROVAL_REQUIRED",
    isLoading: false,
    loadError: null,

    nodes: [],
    edges: [],

    selectedAgentId: null,
    selectedEdgeId: null,
    focusWorkflowKnobs: false,
    leftPanelTab: "agents",

    skills: [],
    heartbeatSchedule: { frequency: "off", time: "08:00" },

    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    lastSavedState: null,

    hasDraftRecovery: false,
    draftTimestamp: null,
    _draftIntervalId: null,

    snapshots: [],
    isLoadingSnapshots: false,

    onNodesChange: (changes) => {
      set((s) => ({
        nodes: applyNodeChanges(changes, s.nodes) as Node<AgentNodeData>[],
      }))
      const isNonDirty = changes.every(c => c.type === "select" || c.type === "dimensions")
      if (!isNonDirty) recheckDirty()
    },
    onEdgesChange: (changes) => {
      // Ignore React Flow changes targeting display-only preview edges.
      const real = changes.filter((c) => {
        if (!("id" in c) || typeof c.id !== "string") return true
        return !c.id.startsWith("preview-")
      })
      if (real.length === 0) return
      set((s) => ({
        edges: applyEdgeChanges(real, s.edges) as Edge<ConnectionEdgeData>[],
      }))
      const isSelectionOnly = real.every(c => c.type === "select")
      if (!isSelectionOnly) recheckDirty()
    },
    tryConnect: (connection: Connection) => {
      const s = get()
      const result = evaluateConnectAttempt({
        sourceId: connection.source,
        targetId: connection.target,
        nodes: s.nodes,
        edges: s.edges,
      })
      if (!result.ok) return result

      const newEdge: Edge<ConnectionEdgeData> = {
        id: `temp-edge-${Date.now()}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: "default",
        data: { condition: "ON_COMPLETE", label: "Delegates", contextNote: null },
        label: undefined,
        animated: true,
        style: { stroke: "var(--bd2)", strokeWidth: 1.5 },
      }
      set((s2) => ({ edges: addEdge(newEdge, s2.edges) as Edge<ConnectionEdgeData>[] }))
      recheckDirty()
      return { ok: true }
    },
    onConnect: (connection: Connection) => {
      get().tryConnect(connection)
    },

    setWorkspace: (id, name, status) => set({ workspaceId: id, workspaceName: name, workspaceStatus: status }),
    setWorkspaceName: (name) => {
      set({ workspaceName: name })
      recheckDirty()
    },
    setMaxRevisionRounds: (rounds) => {
      set({ maxRevisionRounds: rounds })
      recheckDirty()
    },
    setDeliveryMode: (mode) => {
      set({ deliveryMode: mode })
      recheckDirty()
    },
    setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
    selectAgent: (id) => set({ selectedAgentId: id, selectedEdgeId: null }),
    selectEdge: (id) => set({ selectedEdgeId: id, selectedAgentId: null }),
    jumpToWorkflowKnobs: () => {
      const critic = get().nodes.find((n) => (n.data as AgentNodeData).role === "CRITIC")
      set({
        focusWorkflowKnobs: true,
        selectedAgentId: critic?.id ?? null,
        selectedEdgeId: null,
      })
    },
    clearFocusWorkflowKnobs: () => set({ focusWorkflowKnobs: false }),

    addAgent: (opts) => {
      const s = get()
      if (!s.workspaceId) return

      const role: AgentRole = (opts?.role as AgentRole) || "WORKER"
      if (role === "ORCHESTRATOR" && s.nodes.some((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")) return
      if (role === "CRITIC" && s.nodes.some((n) => (n.data as AgentNodeData).role === "CRITIC")) return

      const workerCount = s.nodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
      const defaultName = role === "WORKER" ? `Worker ${workerCount + 1}` : role === "CRITIC" ? "Quality Critic" : "Orchestrator"
      const name = opts?.name || defaultName
      const position = getDefaultPosition(role, s.nodes)
      const color = role === "ORCHESTRATOR" ? "#5BA1F5" : role === "CRITIC" ? "#A78BFA" : WORKER_COLORS[workerCount % WORKER_COLORS.length]

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      const newNode: Node<AgentNodeData> = {
        id: tempId,
        type: "agentNode",
        position,
        data: {
          agentId: tempId, name, role, color,
          model: opts?.model || DEFAULT_MODEL[role] || "anthropic/claude-sonnet-4-6",
          soulMd: opts?.soulMd || "", agentsMd: opts?.agentsMd || "",
          skillCount: 0, agentSkillIds: [],
          hasHeartbeat: false, healthStatus: "idle",
          qualityThreshold: role === "CRITIC" ? 8.0 : undefined,
        },
      }

      const orchNode = s.nodes.find((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")
      const newEdges: Edge<ConnectionEdgeData>[] = []
      if (role === "WORKER" && orchNode) {
        newEdges.push({
          id: `temp-edge-${Date.now()}`,
          source: orchNode.id, target: tempId,
          type: "default",
          data: { condition: "ON_COMPLETE", label: "Delegates", contextNote: null },
          label: undefined,
          animated: true,
          style: { stroke: "var(--bd2)", strokeWidth: 1.5 },
        })
      }

      set({
        nodes: [...s.nodes, newNode],
        edges: newEdges.length > 0 ? [...s.edges, ...newEdges] : s.edges,
        selectedAgentId: tempId,
        selectedEdgeId: null,
      })
      recheckDirty()

      if (role === "ORCHESTRATOR" && !s.nodes.some((n) => (n.data as AgentNodeData).role === "CRITIC")) {
        setTimeout(() => get().addAgent({ role: "CRITIC" }), 50)
      }
    },

    addWorker: () => {
      get().addAgent({ role: "WORKER" })
    },

    removeAgent: (id) => {
      const s = get()
      const node = s.nodes.find((n) => n.id === id)
      if (!node) return
      const d = node.data as AgentNodeData
      if (d.role === "ORCHESTRATOR" || d.role === "CRITIC") return

      set({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedAgentId: s.selectedAgentId === id ? null : s.selectedAgentId,
      })
      recheckDirty()
    },
    deleteAgent: (id) => { get().removeAgent(id) },

    updateAgent: (id, updates) => {
      set((s) => ({
        nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), ...updates } } : n),
      }))
      recheckDirty()
    },
    updateAgentProperty: (id, key, value) => {
      set((s) => ({
        nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), [key]: value } } : n),
      }))
      recheckDirty()
    },
    toggleSkill: (agentId, skillId) => {
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (n.id !== agentId) return n
          const data = n.data as AgentNodeData
          const current = data.agentSkillIds || []
          const updated = current.includes(skillId)
            ? current.filter((sid: string) => sid !== skillId)
            : [...current, skillId]
          return { ...n, data: { ...data, agentSkillIds: updated, skillCount: updated.length } }
        }),
      }))
      recheckDirty()
    },
    setHeartbeatSchedule: (schedule) => {
      set((s) => ({ heartbeatSchedule: { ...s.heartbeatSchedule, ...schedule } }))
      recheckDirty()
    },
    addConnection: ({ source, target }) => {
      return get().tryConnect({ source, target, sourceHandle: null, targetHandle: null })
    },
    removeConnection: (id) => {
      set((s) => ({
        edges: s.edges.filter((e) => e.id !== id),
        selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
      }))
      recheckDirty()
    },
    updateConnection: (edgeId, updates) => {
      const s = get()
      if (updates.source && updates.source === updates.target) return
      const edge = s.edges.find(e => e.id === edgeId)
      if (!edge) return
      const newSource = updates.source || edge.source
      const newTarget = updates.target || edge.target
      if (newSource === newTarget) return
      const check = evaluateConnectAttempt({
        sourceId: newSource,
        targetId: newTarget,
        nodes: s.nodes,
        edges: s.edges.filter((e) => e.id !== edgeId),
      })
      if (!check.ok) return
      set((s2) => ({
        edges: s2.edges.map(e =>
          e.id === edgeId ? { ...e, ...updates } : e
        ),
      }))
      recheckDirty()
    },
    updateConnectionContextNote: (edgeId, contextNote) => {
      const clipped = contextNote.trim().slice(0, 140)
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                data: {
                  ...(e.data as ConnectionEdgeData),
                  contextNote: clipped || null,
                  condition: "ON_COMPLETE",
                },
              }
            : e
        ),
      }))
      recheckDirty()
    },
    addSkill: (skill) => {
      set((s) => {
        if (s.skills.some(sk => sk.id === skill.id)) return s
        return { skills: [...s.skills, skill] }
      })
      recheckDirty()
    },
    revertToLastSaved: () => {
      const s = get()
      if (s.workspaceId) clearDraftFromLocal(s.workspaceId)
      if (s.lastSavedState) {
        set({
          nodes: JSON.parse(JSON.stringify(s.lastSavedState.nodes)),
          edges: JSON.parse(JSON.stringify(s.lastSavedState.edges)),
          workspaceName: s.lastSavedState.workspaceName,
          skills: JSON.parse(JSON.stringify(s.lastSavedState.skills || [])),
          heartbeatSchedule: { ...(s.lastSavedState.heartbeatSchedule || { frequency: "off", time: "08:00" }) },
          isDirty: false,
          hasDraftRecovery: false,
          draftTimestamp: null,
          selectedAgentId: null,
          selectedEdgeId: null,
        })
      }
    },
    loadFromSnapshot: (nodes, edges) => set({ nodes, edges, isDirty: false, selectedAgentId: null, selectedEdgeId: null }),
    markDirty: () => recheckDirty(),
    markSaved: () => set({ isDirty: false, isSaving: false, lastSavedAt: new Date() }),

    restoreDraft: () => {
      const s = get()
      if (!s.workspaceId) return
      const draft = loadDraftFromLocal(s.workspaceId)
      if (draft) {
        set({
          nodes: draft.nodes as Node<AgentNodeData>[],
          edges: draft.edges as Edge<ConnectionEdgeData>[],
          workspaceName: draft.workspaceName,
          skills: (draft.skills || []) as SkillItem[],
          heartbeatSchedule: draft.heartbeatSchedule
            ? { ...draft.heartbeatSchedule }
            : s.heartbeatSchedule,
          isDirty: true,
          hasDraftRecovery: false,
          draftTimestamp: null,
        })
      }
    },

    dismissDraft: () => {
      const s = get()
      if (s.workspaceId) clearDraftFromLocal(s.workspaceId)
      set({ hasDraftRecovery: false, draftTimestamp: null })
    },

    loadWorkspace: async (workspaceId) => {
      const prevInterval = get()._draftIntervalId
      if (prevInterval) clearInterval(prevInterval)

      set({
        isLoading: true, loadError: null, workspaceId,
        nodes: [], edges: [], skills: [], snapshots: [],
        selectedAgentId: null, selectedEdgeId: null,
        workspaceName: "", workspaceStatus: "DRAFT",
        isDirty: false, isSaving: false,
        lastSavedAt: null, lastSavedState: null,
        hasDraftRecovery: false, draftTimestamp: null, _draftIntervalId: null,
        heartbeatSchedule: { frequency: "off", time: "08:00" },
        workspaceTimezone: "UTC",
      })

      try {
        const wsRes = await fetch(`/api/workspaces/${workspaceId}`)

        if (!wsRes.ok) {
          // Batch D: any non-OK (incl. 5xx) sets loadError so the page can show
          // NetworkError + Retry — never a silent empty canvas.
          set({ isLoading: false, loadError: wsRes.status })
          return
        }

        const wsJson = await wsRes.json()
        if (!wsJson.success) throw new Error(wsJson.error?.message || "Failed to load workspace")

        const ws = wsJson.data
        if (!ws) throw new Error("Workspace data is null")

        const roleDefaults: Record<string, { x: number; y: number }> = {
          ORCHESTRATOR: { x: 300, y: 40 },
          CRITIC: { x: 300, y: 400 },
        }
        let workerIdx = 0

        const agents = Array.isArray(ws.agents) ? ws.agents : []

        const nodes: Node<AgentNodeData>[] = agents.map((a: Record<string, unknown>) => {
          const agentSkills = Array.isArray(a.skills) ? a.skills as { skillId: string }[] : []
          const role = a.role as AgentRole

          let position = { x: (a.positionX as number) || 0, y: (a.positionY as number) || 0 }
          if (position.x === 0 && position.y === 0) {
            if (role in roleDefaults) {
              position = roleDefaults[role]
            } else {
              position = { x: 80 + workerIdx * 160, y: 220 }
              workerIdx++
            }
          }
          if (role === "WORKER") workerIdx++

          return {
            id: a.id as string, type: "agentNode",
            position,
            data: {
              agentId: a.id as string, name: a.name as string, role, color: (a.color as string) || "#8BFCAE",
              model: (a.model as string) || "anthropic/claude-sonnet-4-6",
              thinkingDefault: (a.thinkingDefault as string | null) ?? null,
              skillCount: agentSkills.length,
              agentSkillIds: agentSkills.map(s => s.skillId),
              hasHeartbeat: !!a.heartbeatMd || (!!a.heartbeatFrequency && a.heartbeatFrequency !== "off"),
              healthStatus: "idle" as const,
              soulMd: (a.soulMd as string) || "", agentsMd: (a.agentsMd as string) || "",
              reportsTo: (a.reportsTo as string) || undefined, qualityThreshold: a.qualityThreshold as number | undefined,
            },
          }
        })

        const edges: Edge<ConnectionEdgeData>[] = (ws.connections || []).map((c: Record<string, unknown>) => ({
          id: c.id as string,
          source: c.sourceAgentId as string,
          target: c.targetAgentId as string,
          label: undefined,
          type: "default",
          animated: true,
          style: { stroke: "var(--bd2)", strokeWidth: 1.5 },
          data: {
            condition: "ON_COMPLETE",
            label: "Delegates",
            contextNote: typeof c.contextNote === "string" ? c.contextNote : null,
          },
        }))

        const skillsMap = new Map<string, SkillItem>()
        for (const a of agents) {
          const aSkills = (a as Record<string, unknown>).skills
          if (Array.isArray(aSkills)) {
            for (const as_ of aSkills as { skillId?: string; id?: string; skill?: Record<string, unknown> }[]) {
              const sk = as_.skill
              if (sk && typeof sk === "object" && !skillsMap.has(sk.id as string)) {
                skillsMap.set(sk.id as string, {
                  id: sk.id as string,
                  name: (sk.name as string) || "",
                  slug: (sk.slug as string) || (sk.id as string),
                  category: (sk.category as string) || "",
                  description: (sk.description as string) || "",
                })
              }
            }
          }
        }
        const workspaceSkills = Array.from(skillsMap.values())

        const name = (ws.name as string) || ""

        const orchestrator = agents.find((a: Record<string, unknown>) => a.role === "ORCHESTRATOR") as Record<string, unknown> | undefined
        const savedFreq =
          orchestrator && typeof orchestrator.heartbeatFrequency === "string"
            ? (orchestrator.heartbeatFrequency as string)
            : null
        const savedTime =
          orchestrator && typeof orchestrator.heartbeatTime === "string"
            ? (orchestrator.heartbeatTime as string)
            : null
        const heartbeatMd =
          orchestrator && typeof orchestrator.heartbeatMd === "string"
            ? (orchestrator.heartbeatMd as string)
            : null
        const containerState = ws.containerState as
          | { heartbeatCronExpressions?: string | null }
          | null
          | undefined
        const heartbeatCronExpressions =
          containerState && typeof containerState.heartbeatCronExpressions === "string"
            ? containerState.heartbeatCronExpressions
            : null
        const workspaceTimezone =
          typeof ws.timezone === "string" && ws.timezone.length > 0 ? ws.timezone : "UTC"
        const heartbeatSchedule = resolvePickerHeartbeatSchedule({
          heartbeatFrequency: savedFreq,
          heartbeatTime: savedTime,
          heartbeatMd,
          heartbeatCronExpressions,
          timezone: workspaceTimezone,
        })

        const maxRevisionRounds = typeof ws.maxRevisionRounds === "number" ? (ws.maxRevisionRounds as number) : 3
        const deliveryMode: DeliveryModeUi =
          ws.deliveryMode === "AUTO_PROCEED" ? "AUTO_PROCEED" : "APPROVAL_REQUIRED"
        const templateSlug =
          ws.clawTemplate && typeof (ws.clawTemplate as { slug?: string }).slug === "string"
            ? ((ws.clawTemplate as { slug: string }).slug)
            : null

        set({
          nodes, edges, workspaceId, workspaceName: name, workspaceStatus: (ws.status as string) || "DRAFT",
          workspaceTimezone,
          templateSlug,
          maxRevisionRounds,
          deliveryMode,
          skills: workspaceSkills, isLoading: false, isDirty: false, selectedAgentId: null, selectedEdgeId: null,
          focusWorkflowKnobs: false,
          heartbeatSchedule,
          lastSavedState: cloneState(
            nodes,
            edges,
            name,
            workspaceSkills,
            heartbeatSchedule,
            maxRevisionRounds,
            deliveryMode,
          ),
        })

        const draft = loadDraftFromLocal(workspaceId)
        const dbTimestamp = ws.updatedAt ? new Date(ws.updatedAt as string).getTime() : 0
        if (draft && draft.timestamp > dbTimestamp) {
          set({ hasDraftRecovery: true, draftTimestamp: draft.timestamp })
        } else {
          clearDraftFromLocal(workspaceId)
        }

        const intervalId = setInterval(() => {
          const current = get()
          if (current.isDirty && current.workspaceId) {
            saveDraftToLocal(current.workspaceId, {
              nodes: current.nodes,
              edges: current.edges,
              workspaceName: current.workspaceName,
              skills: current.skills,
              heartbeatSchedule: current.heartbeatSchedule,
              timestamp: Date.now(),
            })
          }
        }, 5000)
        set({ _draftIntervalId: intervalId })
      } catch (err) {
        console.error("Failed to load workspace:", err)
        // Network / parse failures — distinct from auth redirects (401/403/404).
        set({ isLoading: false, loadError: 0 })
      }
    },

    saveWorkspace: async () => {
      const s = get()
      if (!s.workspaceId || s.isSaving) return
      set({ isSaving: true })

      try {
        const wid = s.workspaceId

        const nameRes = await fetch(`/api/workspaces/${wid}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: s.workspaceName }),
        })
        if (!nameRes.ok) throw new Error(`Workspace name save failed: ${nameRes.status}`)

        const dbAgentsRes = await fetch(`/api/agents/${wid}`)
        const dbAgentsJson = await dbAgentsRes.json()
        const dbAgents: { id: string }[] = Array.isArray(dbAgentsJson.data) ? dbAgentsJson.data : []

        const idMap = new Map<string, string>()

        const value =
          deserializeSchedule(s.heartbeatSchedule.frequency, s.heartbeatSchedule.time) ?? {
            mode: "off" as const,
          }
        const gate = validateSchedule(value, s.workspaceTimezone)
        if (!gate.ok) {
          throw new Error(gate.errors[0] ?? "Invalid heartbeat schedule")
        }
        const ser = serializeSchedule(value)
        const hbPayload = {
          heartbeatFrequency: ser.heartbeatFrequency,
          heartbeatTime: ser.heartbeatTime,
        }

        for (const node of s.nodes) {
          const d = node.data as AgentNodeData
          const isTemp = node.id.startsWith("temp-")
          const isOrchestrator = d.role === "ORCHESTRATOR"

          if (isTemp) {
            // Batch D: include skillIds on create — omitting drops selected skills
            // (PATCH-only path never runs for brand-new temp agents).
            const createRes = await fetch(`/api/agents/${wid}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: d.name, role: d.role, model: d.model, color: d.color,
                thinkingDefault: d.thinkingDefault ?? null,
                soulMd: d.soulMd || "", agentsMd: d.agentsMd || "",
                positionX: node.position.x, positionY: node.position.y,
                qualityThreshold: d.qualityThreshold,
                skillIds: d.agentSkillIds || [],
              }),
            })
            if (!createRes.ok) throw new Error(`Failed to create agent ${d.name}: ${createRes.status}`)
            const created = await createRes.json()
            const realId = created.data?.id || created.id
            if (realId) {
              idMap.set(node.id, realId)
              if (isOrchestrator) {
                await fetch(`/api/agents/${wid}/${realId}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(hbPayload),
                })
              }
            }
          } else {
            const patchBody: Record<string, unknown> = {
              name: d.name, model: d.model, thinkingDefault: d.thinkingDefault ?? null,
              soulMd: d.soulMd || "", agentsMd: d.agentsMd || "",
              positionX: node.position.x, positionY: node.position.y,
              qualityThreshold: d.qualityThreshold, reportsTo: d.reportsTo || null,
              skillIds: d.agentSkillIds || [],
            }
            if (isOrchestrator) Object.assign(patchBody, hbPayload)
            const patchRes = await fetch(`/api/agents/${wid}/${node.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            })
            if (!patchRes.ok) throw new Error(`Failed to update agent ${d.name}: ${patchRes.status}`)
          }
        }

        const localNodeIds = new Set(s.nodes.map(n => n.id))
        for (const dbAgent of dbAgents) {
          if (!localNodeIds.has(dbAgent.id)) {
            await fetch(`/api/agents/${wid}/${dbAgent.id}`, { method: "DELETE" })
          }
        }

        let updatedNodes = s.nodes.map(n => {
          const realId = idMap.get(n.id)
          if (realId) {
            return { ...n, id: realId, data: { ...(n.data as AgentNodeData), agentId: realId } }
          }
          return n
        }) as Node<AgentNodeData>[]

        let updatedEdges = s.edges.map(e => ({
          ...e,
          source: idMap.get(e.source) || e.source,
          target: idMap.get(e.target) || e.target,
        })) as Edge<ConnectionEdgeData>[]

        const connRes = await fetch(`/api/connections/${wid}`)
        const connJson = await connRes.json()
        const dbConnections: { id: string }[] = Array.isArray(connJson.data) ? connJson.data : []
        const dbConnIds = new Set(dbConnections.map(c => c.id))

        for (let i = 0; i < updatedEdges.length; i++) {
          const edge = updatedEdges[i]
          const isTemp = edge.id.startsWith("temp-") || edge.id.startsWith("edge-")
          if (isTemp || !dbConnIds.has(edge.id)) {
            const createRes = await fetch(`/api/connections/${wid}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceAgentId: edge.source, targetAgentId: edge.target,
                condition: "ON_COMPLETE",
                label: edge.data?.label || null,
                contextNote: edge.data?.contextNote ?? null,
              }),
            })
            if (createRes.ok) {
              const created = await createRes.json()
              const newId = created.data?.id || created.id
              if (newId) updatedEdges[i] = { ...edge, id: newId }
            }
          } else {
            // Persist contextNote edits on existing edges.
            await fetch(`/api/connections/${wid}/${edge.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contextNote: edge.data?.contextNote ?? null,
              }),
            })
          }
        }

        // Workspace choreography knobs (fingerprint v4).
        await fetch(`/api/workspaces/${wid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maxRevisionRounds: s.maxRevisionRounds,
            deliveryMode: s.deliveryMode,
          }),
        })

        const localEdgeIds = new Set(updatedEdges.map(e => e.id))
        for (const dbConn of dbConnections) {
          if (!localEdgeIds.has(dbConn.id)) {
            await fetch(`/api/connections/${wid}/${dbConn.id}`, { method: "DELETE" })
          }
        }

        await fetch(`/api/workspaces/${wid}/snapshots`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "MANUAL_SAVE" }),
        })

        const current = get()
        set({
          nodes: updatedNodes,
          edges: updatedEdges,
          lastSavedAt: new Date(),
          lastSavedState: cloneState(
            updatedNodes,
            updatedEdges,
            current.workspaceName,
            current.skills,
            current.heartbeatSchedule,
            current.maxRevisionRounds,
            current.deliveryMode,
          ),
        })
        queueMicrotask(() => {
          set({ isDirty: false, isSaving: false })
        })

        if (wid) clearDraftFromLocal(wid)
      } catch (err) {
        console.error("Save failed:", err)
        set({ isSaving: false })
      }
    },

    loadSnapshots: async () => {
      const s = get()
      if (!s.workspaceId) return
      set({ isLoadingSnapshots: true })
      try {
        const res = await fetch(`/api/workspaces/${s.workspaceId}/snapshots`)
        const json = await res.json()
        if (json.success) set({ snapshots: json.data, isLoadingSnapshots: false })
        else set({ isLoadingSnapshots: false })
      } catch { set({ isLoadingSnapshots: false }) }
    },

    restoreSnapshot: async (snapshotId) => {
      const s = get()
      if (!s.workspaceId) return
      set({ isLoading: true })
      try {
        const res = await fetch(`/api/workspaces/${s.workspaceId}/snapshots/${snapshotId}/restore`, { method: "POST" })
        const json = await res.json()
        if (!json.success) {
          // Batch D: success:false must clear loading (was stuck forever).
          set({ isLoading: false })
          throw new Error(
            (typeof json.error?.message === "string" && json.error.message) ||
              "Failed to restore version",
          )
        }
        await get().loadWorkspace(s.workspaceId!)
      } catch (err) {
        console.error("Restore failed:", err)
        set({ isLoading: false })
        throw err
      }
    },
  }
})
