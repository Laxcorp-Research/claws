import { create } from "zustand"
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  Connection,
  NodeChange,
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
}

export interface SkillItem {
  id: string
  name: string
  category: string
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
  _positionTimeoutId: ReturnType<typeof setTimeout> | null

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
  addSkill: (skill: SkillItem) => void
  loadFromSnapshot: (nodes: Node<AgentNodeData>[], edges: Edge<ConnectionEdgeData>[]) => void
  markDirty: () => void
  markSaved: () => void

  loadWorkspace: (workspaceId: string) => Promise<void>
  saveWorkspace: () => Promise<void>
  savePositionsOnly: () => Promise<void>
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

let nextNodeId = 100

function hasPositionChanges(changes: NodeChange<Node<AgentNodeData>>[]): boolean {
  return changes.some(c => c.type === "position" && "dragging" in c && !c.dragging)
}

function hasContentChanges(changes: NodeChange<Node<AgentNodeData>>[]): boolean {
  return changes.some(c => c.type !== "position" && c.type !== "dimensions" && c.type !== "select")
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workspaceId: null,
  workspaceName: "",
  workspaceStatus: "DRAFT",
  isLoading: false,

  nodes: [],
  edges: [],

  selectedAgentId: null,
  leftPanelTab: "agents",

  skills: [],
  heartbeatSchedule: { frequency: "daily", time: "08:00" },

  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  _positionTimeoutId: null,

  snapshots: [],
  isLoadingSnapshots: false,

  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) as Node<AgentNodeData>[] }))
    if (hasContentChanges(changes)) {
      set({ isDirty: true })
    }
    if (hasPositionChanges(changes)) {
      const s = get()
      if (s._positionTimeoutId) clearTimeout(s._positionTimeoutId)
      const tid = setTimeout(() => { get().savePositionsOnly() }, 2000)
      set({ _positionTimeoutId: tid })
    }
  },
  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) as Edge<ConnectionEdgeData>[], isDirty: true }))
  },
  onConnect: (connection: Connection) => {
    const newEdge: Edge<ConnectionEdgeData> = {
      id: `edge-${Date.now()}`, source: connection.source, target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined, targetHandle: connection.targetHandle ?? undefined,
      type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true,
    }
    set((s) => ({ edges: addEdge(newEdge, s.edges) as Edge<ConnectionEdgeData>[], isDirty: true }))
  },

  setWorkspace: (id, name, status) => set({ workspaceId: id, workspaceName: name, workspaceStatus: status }),
  setWorkspaceName: (name) => set({ workspaceName: name, isDirty: true }),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  selectAgent: (id) => set({ selectedAgentId: id }),

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
        soulMd: agent.soulMd || "", agentsMd: agent.agentsMd || "",
        skillCount: 0, agentSkillIds: [],
        hasHeartbeat: agent.hasHeartbeat || false, healthStatus: "idle",
        qualityThreshold: agent.role === "CRITIC" ? 8.0 : undefined,
      },
    }
    set((s) => ({ nodes: [...s.nodes, newNode], selectedAgentId: id, isDirty: true }))
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
      data: { agentId: id, name: `Worker ${workerCount + 1}`, role: "WORKER", color, model: DEFAULT_MODEL.WORKER, soulMd: "", agentsMd: "", skillCount: 0, agentSkillIds: [], hasHeartbeat: false, healthStatus: "idle" },
    }
    const newEdges: Edge<ConnectionEdgeData>[] = []
    if (orchId) {
      newEdges.push({ id: `edge-${Date.now()}`, source: orchId, target: id, type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true })
    }
    set((s) => ({ nodes: [...s.nodes, newNode], edges: [...s.edges, ...newEdges], selectedAgentId: id, isDirty: true }))
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
  },
  deleteAgent: (id) => get().removeAgent(id),

  updateAgent: (id, updates) => {
    set((s) => ({ nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), ...updates } } : n), isDirty: true }))
  },
  updateAgentProperty: (id, key, value) => {
    set((s) => ({ nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), [key]: value } } : n), isDirty: true }))
  },
  toggleSkill: (agentId, skillId) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== agentId) return n
        const data = n.data as AgentNodeData
        const current = data.agentSkillIds || []
        const updated = current.includes(skillId)
          ? current.filter((id: string) => id !== skillId)
          : [...current, skillId]
        return { ...n, data: { ...data, agentSkillIds: updated, skillCount: updated.length } }
      }),
      isDirty: true,
    }))
  },
  setHeartbeatSchedule: (schedule) => {
    set((s) => ({ heartbeatSchedule: { ...s.heartbeatSchedule, ...schedule }, isDirty: true }))
  },
  removeConnection: (id) => {
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id), isDirty: true }))
  },
  addSkill: (skill) => {
    set((s) => {
      if (s.skills.some(sk => sk.id === skill.id)) return s
      return { skills: [...s.skills, skill] }
    })
  },
  loadFromSnapshot: (nodes, edges) => set({ nodes, edges, isDirty: false, selectedAgentId: null }),
  markDirty: () => set({ isDirty: true }),
  markSaved: () => set({ isDirty: false, isSaving: false, lastSavedAt: new Date() }),

  loadWorkspace: async (workspaceId) => {
    set({ isLoading: true, workspaceId })
    try {
      const [wsRes, skillsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}`),
        fetch("/api/skills"),
      ])
      const wsJson = await wsRes.json()
      if (!wsJson.success) throw new Error(wsJson.error?.message || "Failed to load workspace")

      const ws = wsJson.data
      const nodes: Node<AgentNodeData>[] = (ws.agents || []).map((a: Record<string, unknown>) => {
        const agentSkills = Array.isArray(a.skills) ? a.skills as { skillId: string }[] : []
        return {
          id: a.id as string, type: "agentNode",
          position: { x: a.positionX as number, y: a.positionY as number },
          data: {
            agentId: a.id as string, name: a.name as string, role: a.role as AgentRole, color: a.color as string,
            model: a.model as string,
            skillCount: agentSkills.length,
            agentSkillIds: agentSkills.map(s => s.skillId),
            hasHeartbeat: !!(a.heartbeatMd), healthStatus: "idle" as const,
            soulMd: (a.soulMd as string) || "", agentsMd: (a.agentsMd as string) || "",
            reportsTo: (a.reportsTo as string) || undefined, qualityThreshold: a.qualityThreshold as number | undefined,
          },
        }
      })

      const edges: Edge<ConnectionEdgeData>[] = (ws.connections || []).map((c: Record<string, unknown>) => ({
        id: c.id as string, source: c.sourceAgentId as string, target: c.targetAgentId as string,
        label: (c.label as string) || ((c.condition as string) || "ON_COMPLETE").replace(/_/g, " ").toLowerCase(),
        type: "default", animated: true,
        data: { condition: (c.condition as ConnectionCondition) || "ON_COMPLETE", label: (c.label as string) || "" },
      }))

      let availableSkills: SkillItem[] = []
      if (skillsRes.ok) {
        const skillsJson = await skillsRes.json()
        availableSkills = ((skillsJson.data || []) as { id: string; name: string; category: string }[]).map(s => ({
          id: s.id, name: s.name, category: s.category,
        }))
      }

      set({
        nodes, edges, workspaceId, workspaceName: ws.name as string, workspaceStatus: ws.status as string,
        skills: availableSkills, isLoading: false, isDirty: false, selectedAgentId: null,
      })
    } catch (err) {
      console.error("Failed to load workspace:", err)
      set({ isLoading: false })
    }
  },

  saveWorkspace: async () => {
    const s = get()
    if (!s.workspaceId || !s.isDirty || s.isSaving) return
    set({ isSaving: true })

    try {
      // 1. Save positions
      const positions = s.nodes.map((n) => ({ id: n.id, positionX: n.position.x, positionY: n.position.y }))
      await fetch(`/api/agents/${s.workspaceId}/bulk-position`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions }),
      })

      // 2. Save each agent's properties + skills
      for (const node of s.nodes) {
        const d = node.data as AgentNodeData
        await fetch(`/api/agents/${s.workspaceId}/${node.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: d.name, model: d.model, soulMd: d.soulMd, agentsMd: d.agentsMd,
            qualityThreshold: d.qualityThreshold, reportsTo: d.reportsTo || null,
            skillIds: d.agentSkillIds || [],
          }),
        })
      }

      // 3. Sync connections: fetch current DB connections, diff, create/delete
      const connRes = await fetch(`/api/connections/${s.workspaceId}`)
      const connJson = await connRes.json()
      const dbConnections: { id: string }[] = connJson.data || []

      const currentEdgeIds = new Set(s.edges.map(e => e.id))
      const dbIds = new Set(dbConnections.map(c => c.id))

      // Delete connections that were removed
      for (const conn of dbConnections) {
        if (!currentEdgeIds.has(conn.id)) {
          await fetch(`/api/connections/${s.workspaceId}/${conn.id}`, { method: "DELETE" })
        }
      }

      // Create connections that are new (temp IDs not in DB)
      const updatedEdges = [...s.edges]
      for (let i = 0; i < updatedEdges.length; i++) {
        const edge = updatedEdges[i]
        if (!dbIds.has(edge.id)) {
          const res = await fetch(`/api/connections/${s.workspaceId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceAgentId: edge.source, targetAgentId: edge.target,
              condition: edge.data?.condition || "ON_COMPLETE",
              label: edge.data?.label || null,
            }),
          })
          const json = await res.json()
          if (json.success && json.data?.id) {
            updatedEdges[i] = { ...edge, id: json.data.id }
          }
        }
      }

      // 4. Create a MANUAL_SAVE snapshot
      await fetch(`/api/workspaces/${s.workspaceId}/snapshots`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "MANUAL_SAVE" }),
      })

      set({ edges: updatedEdges, isDirty: false, isSaving: false, lastSavedAt: new Date() })
    } catch (err) {
      console.error("Save failed:", err)
      set({ isSaving: false })
    }
  },

  savePositionsOnly: async () => {
    const s = get()
    if (!s.workspaceId) return
    try {
      const positions = s.nodes.map((n) => ({ id: n.id, positionX: n.position.x, positionY: n.position.y }))
      await fetch(`/api/agents/${s.workspaceId}/bulk-position`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions }),
      })
    } catch (err) {
      console.error("Position save failed:", err)
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
      if (json.success) await get().loadWorkspace(s.workspaceId!)
    } catch (err) {
      console.error("Restore failed:", err)
      set({ isLoading: false })
    }
  },
}))
