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

interface SavedState {
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
  workspaceName: string
}

interface BuilderState {
  workspaceId: string | null
  workspaceName: string
  workspaceStatus: string
  isLoading: boolean

  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]

  selectedAgentId: string | null
  selectedEdgeId: string | null
  leftPanelTab: "agents" | "skills"

  skills: SkillItem[]
  heartbeatSchedule: { frequency: string; time: string }

  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  lastSavedState: SavedState | null
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
  selectEdge: (id: string | null) => void
  addAgent: (opts?: { name?: string; role?: AgentRole; model?: string; soulMd?: string; agentsMd?: string }) => Promise<void>
  addWorker: () => Promise<void>
  removeAgent: (id: string) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  updateAgent: (id: string, updates: Partial<AgentNodeData>) => void
  updateAgentProperty: (id: string, key: string, value: unknown) => void
  toggleSkill: (agentId: string, skillId: string) => void
  setHeartbeatSchedule: (schedule: Partial<{ frequency: string; time: string }>) => void
  removeConnection: (id: string) => void
  updateConnectionCondition: (edgeId: string, condition: string) => void
  addSkill: (skill: SkillItem) => void
  revertToLastSaved: () => void
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

const CONDITION_LABELS: Record<string, string> = {
  ON_COMPLETE: "On complete",
  ON_APPROVAL: "On approval",
  ON_REJECTION: "On rejection",
  ON_SCHEDULE: "On schedule",
  ON_HUMAN_APPROVE: "On human approval",
}

function getDefaultPosition(role: AgentRole, existingNodes: Node[]): { x: number; y: number } {
  const workerCount = existingNodes.filter((n) => (n.data as AgentNodeData).role === "WORKER").length
  switch (role) {
    case "ORCHESTRATOR": return { x: 300, y: 40 }
    case "CRITIC": return { x: 300, y: 400 }
    case "WORKER": return { x: 80 + workerCount * 160, y: 220 }
  }
}

function hasPositionChanges(changes: NodeChange<Node<AgentNodeData>>[]): boolean {
  return changes.some(c => c.type === "position" && "dragging" in c && !c.dragging)
}

function hasContentChanges(changes: NodeChange<Node<AgentNodeData>>[]): boolean {
  return changes.some(c => c.type !== "position" && c.type !== "dimensions" && c.type !== "select")
}

function cloneState(nodes: Node<AgentNodeData>[], edges: Edge<ConnectionEdgeData>[], name: string): SavedState {
  return { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), workspaceName: name }
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  workspaceId: null,
  workspaceName: "",
  workspaceStatus: "DRAFT",
  isLoading: false,

  nodes: [],
  edges: [],

  selectedAgentId: null,
  selectedEdgeId: null,
  leftPanelTab: "agents",

  skills: [],
  heartbeatSchedule: { frequency: "daily", time: "08:00" },

  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  lastSavedState: null,
  _positionTimeoutId: null,

  snapshots: [],
  isLoadingSnapshots: false,

  onNodesChange: (changes) => {
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes) as Node<AgentNodeData>[],
      isDirty: hasContentChanges(changes) ? (s.isSaving ? s.isDirty : true) : s.isDirty,
    }))
    if (hasPositionChanges(changes)) {
      const s = get()
      if (s._positionTimeoutId) clearTimeout(s._positionTimeoutId)
      const tid = setTimeout(() => { get().savePositionsOnly() }, 2000)
      set({ _positionTimeoutId: tid })
    }
  },
  onEdgesChange: (changes) => {
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges) as Edge<ConnectionEdgeData>[],
      isDirty: s.isSaving ? s.isDirty : true,
    }))
  },
  onConnect: (connection: Connection) => {
    const newEdge: Edge<ConnectionEdgeData> = {
      id: `edge-${Date.now()}`, source: connection.source, target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined, targetHandle: connection.targetHandle ?? undefined,
      type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true,
    }
    set((s) => ({ edges: addEdge(newEdge, s.edges) as Edge<ConnectionEdgeData>[], isDirty: s.isSaving ? s.isDirty : true }))
  },

  setWorkspace: (id, name, status) => set({ workspaceId: id, workspaceName: name, workspaceStatus: status }),
  setWorkspaceName: (name) => set((s) => ({ workspaceName: name, isDirty: s.isSaving ? s.isDirty : true })),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
  selectAgent: (id) => set({ selectedAgentId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedAgentId: null }),

  // Creates agent in DB first, then adds to local state with the real DB ID
  addAgent: async (opts) => {
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

    try {
      const res = await fetch(`/api/agents/${s.workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          role,
          model: opts?.model || DEFAULT_MODEL[role] || "anthropic/claude-sonnet-4-6",
          color,
          soulMd: opts?.soulMd || "",
          agentsMd: opts?.agentsMd || "",
          positionX: position.x,
          positionY: position.y,
          qualityThreshold: role === "CRITIC" ? 8.0 : undefined,
        }),
      })
      if (!res.ok) {
        console.error("Failed to create agent:", res.status)
        return
      }
      const json = await res.json()
      const agent = json.data

      const newNode: Node<AgentNodeData> = {
        id: agent.id,
        type: "agentNode",
        position: { x: agent.positionX ?? position.x, y: agent.positionY ?? position.y },
        data: {
          agentId: agent.id, name: agent.name, role: agent.role as AgentRole, color: agent.color || color,
          model: agent.model, soulMd: agent.soulMd || "", agentsMd: agent.agentsMd || "",
          skillCount: 0, agentSkillIds: [],
          hasHeartbeat: !!(agent.heartbeatMd), healthStatus: "idle",
          qualityThreshold: agent.qualityThreshold ?? undefined,
        },
      }

      // If worker and orchestrator exists, auto-create a connection
      const orchId = get().nodes.find((n) => (n.data as AgentNodeData).role === "ORCHESTRATOR")?.id
      const newEdges: Edge<ConnectionEdgeData>[] = []
      if (role === "WORKER" && orchId) {
        try {
          const connRes = await fetch(`/api/connections/${s.workspaceId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceAgentId: orchId, targetAgentId: agent.id, condition: "ON_COMPLETE" }),
          })
          if (connRes.ok) {
            const connJson = await connRes.json()
            const conn = connJson.data
            newEdges.push({
              id: conn.id, source: orchId, target: agent.id,
              type: "default", data: { condition: "ON_COMPLETE", label: "On complete" }, label: "On complete", animated: true,
            })
          }
        } catch { /* connection creation is optional */ }
      }

      set((state) => ({
        nodes: [...state.nodes, newNode],
        edges: newEdges.length > 0 ? [...state.edges, ...newEdges] : state.edges,
        selectedAgentId: agent.id,
        selectedEdgeId: null,
      }))
    } catch (error) {
      console.error("Failed to create agent:", error)
    }
  },

  addWorker: async () => {
    await get().addAgent({ role: "WORKER" })
  },

  // Deletes from DB then removes from local state
  removeAgent: async (id) => {
    const s = get()
    if (!s.workspaceId) return
    const node = s.nodes.find((n) => n.id === id)
    if (!node) return
    const d = node.data as AgentNodeData
    if (d.role === "ORCHESTRATOR" || d.role === "CRITIC") return

    try {
      const res = await fetch(`/api/agents/${s.workspaceId}/${id}`, { method: "DELETE" })
      if (!res.ok) {
        console.error("Failed to delete agent:", res.status)
        return
      }
    } catch (error) {
      console.error("Failed to delete agent:", error)
      return
    }

    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
    }))
  },
  deleteAgent: async (id) => { await get().removeAgent(id) },

  updateAgent: (id, updates) => {
    set((s) => ({
      nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), ...updates } } : n),
      isDirty: s.isSaving ? s.isDirty : true,
    }))
  },
  updateAgentProperty: (id, key, value) => {
    set((s) => ({
      nodes: s.nodes.map((n) => n.id === id ? { ...n, data: { ...(n.data as AgentNodeData), [key]: value } } : n),
      isDirty: s.isSaving ? s.isDirty : true,
    }))
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
      isDirty: s.isSaving ? s.isDirty : true,
    }))
  },
  setHeartbeatSchedule: (schedule) => {
    set((s) => ({ heartbeatSchedule: { ...s.heartbeatSchedule, ...schedule }, isDirty: s.isSaving ? s.isDirty : true }))
  },
  removeConnection: (id) => {
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
      isDirty: s.isSaving ? s.isDirty : true,
    }))
  },
  updateConnectionCondition: (edgeId, condition) => {
    set((s) => ({
      edges: s.edges.map(e =>
        e.id === edgeId
          ? { ...e, data: { ...(e.data as ConnectionEdgeData), condition: condition as ConnectionCondition }, label: CONDITION_LABELS[condition] || condition }
          : e
      ),
      isDirty: s.isSaving ? s.isDirty : true,
    }))
  },
  addSkill: (skill) => {
    set((s) => {
      if (s.skills.some(sk => sk.id === skill.id)) return s
      return { skills: [...s.skills, skill] }
    })
  },
  revertToLastSaved: () => {
    const s = get()
    if (s._positionTimeoutId) clearTimeout(s._positionTimeoutId)
    if (s.lastSavedState) {
      set({
        nodes: JSON.parse(JSON.stringify(s.lastSavedState.nodes)),
        edges: JSON.parse(JSON.stringify(s.lastSavedState.edges)),
        workspaceName: s.lastSavedState.workspaceName,
        isDirty: false,
        _positionTimeoutId: null,
        selectedAgentId: null,
        selectedEdgeId: null,
      })
    }
  },
  loadFromSnapshot: (nodes, edges) => set({ nodes, edges, isDirty: false, selectedAgentId: null, selectedEdgeId: null }),
  markDirty: () => set((s) => ({ isDirty: s.isSaving ? s.isDirty : true })),
  markSaved: () => set({ isDirty: false, isSaving: false, lastSavedAt: new Date() }),

  // Full reset before loading to prevent state bleed between workspaces
  loadWorkspace: async (workspaceId) => {
    const prevTimeout = get()._positionTimeoutId
    if (prevTimeout) clearTimeout(prevTimeout)

    set({
      isLoading: true, workspaceId,
      nodes: [], edges: [], skills: [], snapshots: [],
      selectedAgentId: null, selectedEdgeId: null,
      workspaceName: "", workspaceStatus: "DRAFT",
      isDirty: false, isSaving: false,
      lastSavedAt: null, lastSavedState: null, _positionTimeoutId: null,
      heartbeatSchedule: { frequency: "daily", time: "08:00" },
    })

    try {
      const [wsRes, skillsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}`),
        fetch("/api/skills"),
      ])
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
      console.log("[LOAD] Raw agents from API:", agents.length, agents.map((a: Record<string, unknown>) => ({ id: a.id, role: a.role, positionX: a.positionX, positionY: a.positionY })))

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
        label: (c.label as string) || CONDITION_LABELS[(c.condition as string) || "ON_COMPLETE"] || "On complete",
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

      const name = (ws.name as string) || ""
      console.log("[LOAD] Mapped nodes:", nodes.length, "edges:", edges.length, "name:", name)

      set({
        nodes, edges, workspaceId, workspaceName: name, workspaceStatus: (ws.status as string) || "DRAFT",
        skills: availableSkills, isLoading: false, isDirty: false, selectedAgentId: null, selectedEdgeId: null,
        lastSavedState: cloneState(nodes, edges, name),
      })
    } catch (err) {
      console.error("[LOAD] Failed to load workspace:", err)
      set({ isLoading: false })
    }
  },

  // Save with proper error handling + queueMicrotask to fix isDirty race
  saveWorkspace: async () => {
    const s = get()
    if (!s.workspaceId || s.isSaving) return
    set({ isSaving: true })

    try {
      const wid = s.workspaceId

      // 1. Save workspace name
      const nameRes = await fetch(`/api/workspaces/${wid}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.workspaceName }),
      })
      if (!nameRes.ok) throw new Error(`Workspace name save failed: ${nameRes.status}`)

      // 2. Save each agent's properties + positions + skills
      for (const node of s.nodes) {
        const d = node.data as AgentNodeData
        const patchRes = await fetch(`/api/agents/${wid}/${node.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: d.name, model: d.model, soulMd: d.soulMd || "", agentsMd: d.agentsMd || "",
            positionX: node.position.x, positionY: node.position.y,
            qualityThreshold: d.qualityThreshold, reportsTo: d.reportsTo || null,
            skillIds: d.agentSkillIds || [],
          }),
        })
        if (!patchRes.ok) throw new Error(`Agent save failed for ${d.name}: ${patchRes.status}`)
      }

      // 3. Sync connections
      const connRes = await fetch(`/api/connections/${wid}`)
      const connJson = await connRes.json()
      const dbConnections: { id: string }[] = connJson.data || []
      const dbIds = new Set(dbConnections.map(c => c.id))
      const localEdgeIds = new Set(s.edges.map(e => e.id))

      for (const conn of dbConnections) {
        if (!localEdgeIds.has(conn.id)) {
          await fetch(`/api/connections/${wid}/${conn.id}`, { method: "DELETE" })
        }
      }

      const updatedEdges = [...s.edges]
      for (let i = 0; i < updatedEdges.length; i++) {
        const edge = updatedEdges[i]
        if (!dbIds.has(edge.id)) {
          const createRes = await fetch(`/api/connections/${wid}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceAgentId: edge.source, targetAgentId: edge.target,
              condition: edge.data?.condition || "ON_COMPLETE",
              label: edge.data?.label || null,
            }),
          })
          if (createRes.ok) {
            const created = await createRes.json()
            if (created.data?.id) updatedEdges[i] = { ...edge, id: created.data.id }
          }
        }
      }

      // 4. Create MANUAL_SAVE snapshot
      await fetch(`/api/workspaces/${wid}/snapshots`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "MANUAL_SAVE" }),
      })

      // 5. Update edges + capture saved state, then reset flags via microtask
      const currentName = get().workspaceName
      const currentNodes = get().nodes
      set({
        edges: updatedEdges,
        lastSavedAt: new Date(),
        lastSavedState: cloneState(currentNodes, updatedEdges, currentName),
      })
      queueMicrotask(() => {
        set({ isDirty: false, isSaving: false })
      })
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
