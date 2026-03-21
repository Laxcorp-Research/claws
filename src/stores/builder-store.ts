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
  soulMd: string
  agentsMd: string
  skillCount: number
  hasHeartbeat: boolean
  healthStatus: "healthy" | "idle" | "error"
  qualityThreshold?: number
  reportsTo?: string
  outputsTo?: string
}

export interface ConnectionEdgeData extends Record<string, unknown> {
  condition: ConnectionCondition
  label: string
}

export interface SkillItem {
  id: string
  name: string
  category: string
  assigned: boolean
}

export interface SnapshotItem {
  id: string
  version: number
  trigger: string
  label: string | null
  createdAt: string
}

interface BuilderState {
  workspaceId: string | null
  workspaceName: string
  workspaceStatus: string
  isLoading: boolean

  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]

  selectedAgentId: string | null
  leftPanelTab: "agents" | "skills"

  skills: SkillItem[]
  heartbeatSchedule: { frequency: string; time: string }

  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  _saveTimeoutId: ReturnType<typeof setTimeout> | null

  snapshots: SnapshotItem[]
  isLoadingSnapshots: boolean

  onNodesChange: OnNodesChange<Node<AgentNodeData>>
  onEdgesChange: OnEdgesChange<Edge<ConnectionEdgeData>>
  onConnect: OnConnect

  setWorkspace: (id: string, name: string, status: string) => void
  setWorkspaceName: (name: string) => void
  setLeftPanelTab: (tab: "agents" | "skills") => void
  selectAgent: (id: string | null) => void
  addAgent: (agent: Partial<AgentNodeData> & { name: string; role: AgentRole }) => void
  addWorker: () => void
  removeAgent: (id: string) => void
  deleteAgent: (id: string) => void
  updateAgent: (id: string, updates: Partial<AgentNodeData>) => void
  updateAgentProperty: (id: string, key: string, value: unknown) => void
  toggleSkill: (agentId: string, skillId: string) => void
  setHeartbeatSchedule: (schedule: Partial<{ frequency: string; time: string }>) => void
  removeConnection: (id: string) => void
  loadFromSnapshot: (nodes: Node<AgentNodeData>[], edges: Edge<ConnectionEdgeData>[]) => void
  markDirty: () => void
  markSaved: () => void

  loadWorkspace: (workspaceId: string) => Promise<void>
  saveWorkspace: () => Promise<void>
  _scheduleSave: () => void
  loadSnapshots: () => Promise<void>
  restoreSnapshot: (snapshotId: string) => Promise<void>
}

const WORKER_COLORS = ["#8BFCAE", "#5BA1F5", "#FFB1AB", "#FFDC6E", "#FFB1AB", "#8BFCAE"]

const DEFAULT_SKILLS: SkillItem[] = [
  { id: "sk1", name: "Web Search", category: "CORE", assigned: false },
  { id: "sk2", name: "Email Send", category: "EMAIL", assigned: false },
  { id: "sk3", name: "CRM Update", category: "CRM", assigned: false },
  { id: "sk4", name: "Calendar Read", category: "CALENDAR", assigned: false },
  { id: "sk5", name: "File Read/Write", category: "CORE", assigned: false },
  { id: "sk6", name: "Slack Message", category: "MESSAGING", assigned: false },
  { id: "sk7", name: "Database Query", category: "CORE", assigned: false },
  { id: "sk8", name: "API Call", category: "CORE", assigned: false },
]

function getDefaultPosition(role: AgentRole, existingNodes: Node[]): { x: number; y: number } {
  const workerCount = existingNodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
  switch (role) {
    case "ORCHESTRATOR": return { x: 300, y: 40 }
    case "CRITIC": return { x: 300, y: 400 }
    case "WORKER": return { x: 80 + workerCount * 160, y: 220 }
  }
}

let nextNodeId = 100

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workspaceId: null,
  workspaceName: "",
  workspaceStatus: "DRAFT",
  isLoading: false,

  nodes: [],
  edges: [],

  selectedAgentId: null,
  leftPanelTab: "agents",

  skills: DEFAULT_SKILLS,
  heartbeatSchedule: { frequency: "daily", time: "08:00" },

  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  _saveTimeoutId: null,

  snapshots: [],
  isLoadingSnapshots: false,

  // --- React Flow handlers ---
  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) as Node<AgentNodeData>[], isDirty: true }))
    get()._scheduleSave()
  },
  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) as Edge<ConnectionEdgeData>[], isDirty: true }))
    get()._scheduleSave()
  },
  onConnect: (connection: Connection) => {
    const newEdge: Edge<ConnectionEdgeData> = {
      id: `edge-${Date.now()}`, source: connection.source, target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined, targetHandle: connection.targetHandle ?? undefined,
      type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true,
    }
    set((s) => ({ edges: addEdge(newEdge, s.edges) as Edge<ConnectionEdgeData>[], isDirty: true }))
    get()._scheduleSave()
  },

  // --- Basic setters ---
  setWorkspace: (id, name, status) => set({ workspaceId: id, workspaceName: name, workspaceStatus: status }),
  setWorkspaceName: (name) => { set({ workspaceName: name, isDirty: true }); get()._scheduleSave() },
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  selectAgent: (id) => set({ selectedAgentId: id }),

  // --- Agent CRUD ---
  addAgent: (agent) => {
    const s = get()
    if (agent.role === "ORCHESTRATOR" && s.nodes.some((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")) return
    if (agent.role === "CRITIC" && s.nodes.some((n) => (n.data as AgentNodeData).role === "CRITIC")) return

    const workerIndex = s.nodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
    const color = agent.role === "ORCHESTRATOR" ? "#5BA1F5" : agent.role === "CRITIC" ? "#A78BFA" : agent.color || WORKER_COLORS[workerIndex % WORKER_COLORS.length]
    const id = `agent-${nextNodeId++}`
    const position = getDefaultPosition(agent.role, s.nodes)

    const newNode: Node<AgentNodeData> = {
      id, type: "agentNode", position,
      data: {
        agentId: id, name: agent.name, role: agent.role, color,
        model: agent.model || DEFAULT_MODEL[agent.role] || "anthropic/claude-sonnet-4-6",
        soulMd: agent.soulMd || "", agentsMd: agent.agentsMd || "", skillCount: agent.skillCount || 0,
        hasHeartbeat: agent.hasHeartbeat || false, healthStatus: "idle",
        qualityThreshold: agent.role === "CRITIC" ? 8.0 : undefined,
      },
    }
    set((s) => ({ nodes: [...s.nodes, newNode], selectedAgentId: id, isDirty: true }))
    get()._scheduleSave()
  },

  addWorker: () => {
    const s = get()
    const workerCount = s.nodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
    const orchId = s.nodes.find((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")?.id
    const id = `agent-${nextNodeId++}`
    const color = WORKER_COLORS[workerCount % WORKER_COLORS.length]
    const position = getDefaultPosition("WORKER", s.nodes)

    const newNode: Node<AgentNodeData> = {
      id, type: "agentNode", position,
      data: { agentId: id, name: `Worker ${workerCount + 1}`, role: "WORKER", color, model: DEFAULT_MODEL.WORKER, soulMd: "", agentsMd: "", skillCount: 0, hasHeartbeat: false, healthStatus: "idle" },
    }
    const newEdges: Edge<ConnectionEdgeData>[] = []
    if (orchId) {
      newEdges.push({ id: `edge-${Date.now()}`, source: orchId, target: id, type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true })
    }
    set((s) => ({ nodes: [...s.nodes, newNode], edges: [...s.edges, ...newEdges], selectedAgentId: id, isDirty: true }))
    get()._scheduleSave()
  },

  removeAgent: (id) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const d = node.data as AgentNodeData
    if (d.role === "ORCHESTRATOR" || d.role === "CRITIC") return
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id), edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedAgentId: s.selectedAgentId === id ? null : s.selectedAgentId, isDirty: true,
    }))
    get()._scheduleSave()
  },
  deleteAgent: (id) => get().removeAgent(id),

  updateAgent: (id, updates) => {
    set((s) => ({ nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), ...updates } } : n), isDirty: true }))
    get()._scheduleSave()
  },
  updateAgentProperty: (id, key, value) => {
    set((s) => ({ nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), [key]: value } } : n), isDirty: true }))
    get()._scheduleSave()
  },
  toggleSkill: (_agentId, skillId) => {
    set((s) => ({ skills: s.skills.map((sk) => sk.id === skillId ? { ...sk, assigned: !sk.assigned } : sk), isDirty: true }))
    get()._scheduleSave()
  },
  setHeartbeatSchedule: (schedule) => {
    set((s) => ({ heartbeatSchedule: { ...s.heartbeatSchedule, ...schedule }, isDirty: true }))
    get()._scheduleSave()
  },
  removeConnection: (id) => {
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id), isDirty: true }))
    get()._scheduleSave()
  },
  loadFromSnapshot: (nodes, edges) => set({ nodes, edges, isDirty: false, selectedAgentId: null }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, isSaving: false, lastSavedAt: new Date() }),

  // --- Persistence: Load ---
  loadWorkspace: async (workspaceId) => {
    set({ isLoading: true, workspaceId })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message || "Failed to load workspace")

      const ws = json.data
      const nodes: Node<AgentNodeData>[] = (ws.agents || []).map((a: Record<string, unknown>) => ({
        id: a.id as string, type: "agentNode",
        position: { x: a.positionX as number, y: a.positionY as number },
        data: {
          agentId: a.id as string, name: a.name as string, role: a.role as AgentRole, color: a.color as string,
          model: a.model as string, skillCount: Array.isArray(a.skills) ? a.skills.length : 0,
          hasHeartbeat: !!(a.heartbeatMd), healthStatus: "idle" as const,
          soulMd: (a.soulMd as string) || "", agentsMd: (a.agentsMd as string) || "",
          reportsTo: (a.reportsTo as string) || undefined, qualityThreshold: a.qualityThreshold as number | undefined,
        },
      }))

      const edges: Edge<ConnectionEdgeData>[] = (ws.connections || []).map((c: Record<string, unknown>) => ({
        id: c.id as string, source: c.sourceAgentId as string, target: c.targetAgentId as string,
        label: (c.label as string) || ((c.condition as string) || "ON_COMPLETE").replace(/_/g, " ").toLowerCase(),
        type: "default", animated: true,
        data: { condition: (c.condition as ConnectionCondition) || "ON_COMPLETE", label: (c.label as string) || "" },
      }))

      set({
        nodes, edges, workspaceId, workspaceName: ws.name as string, workspaceStatus: ws.status as string,
        isLoading: false, isDirty: false, selectedAgentId: null,
      })
    } catch (err) {
      console.error("Failed to load workspace:", err)
      set({ isLoading: false })
    }
  },

  // --- Persistence: Save ---
  saveWorkspace: async () => {
    const s = get()
    if (!s.workspaceId || !s.isDirty) return
    set({ isSaving: true })

    try {
      const positions = s.nodes.map((n) => ({ id: n.id, positionX: n.position.x, positionY: n.position.y }))
      await fetch(`/api/agents/${s.workspaceId}/bulk-position`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions }),
      })

      for (const node of s.nodes) {
        const d = node.data as AgentNodeData
        await fetch(`/api/agents/${s.workspaceId}/${node.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: d.name, model: d.model, soulMd: d.soulMd, agentsMd: d.agentsMd, qualityThreshold: d.qualityThreshold, reportsTo: d.reportsTo || null }),
        })
      }

      await fetch(`/api/workspaces/${s.workspaceId}/snapshots`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "AUTO_SAVE" }),
      })

      set({ isDirty: false, isSaving: false, lastSavedAt: new Date() })
    } catch (err) {
      console.error("Save failed:", err)
      set({ isSaving: false })
    }
  },

  // --- Auto-save debounce ---
  _scheduleSave: () => {
    const s = get()
    if (s._saveTimeoutId) clearTimeout(s._saveTimeoutId)
    const timeoutId = setTimeout(() => { get().saveWorkspace() }, 2000)
    set({ _saveTimeoutId: timeoutId, isDirty: true })
  },

  // --- Version history ---
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
      if (json.success) await get().loadWorkspace(s.workspaceId!)
    } catch (err) {
      console.error("Restore failed:", err)
      set({ isLoading: false })
    }
  },
}))
