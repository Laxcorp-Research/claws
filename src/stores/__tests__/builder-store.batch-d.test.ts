/**
 * Batch D — builder data-loss / restore / load-error locks.
 * MUTATION: reverse each fix → fail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { useBuilderStore, type AgentNodeData } from "@/stores/builder-store"
import type { Node } from "@xyflow/react"

const ROOT = process.cwd()

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function tempWorker(skillIds: string[]): Node<AgentNodeData> {
  return {
    id: "temp-worker-1",
    type: "agentNode",
    position: { x: 80, y: 220 },
    data: {
      agentId: "temp-worker-1",
      name: "Researcher",
      role: "WORKER",
      color: "#8BFCAE",
      model: "anthropic/claude-sonnet-4-6",
      soulMd: "",
      agentsMd: "",
      skillCount: skillIds.length,
      agentSkillIds: skillIds,
      hasHeartbeat: false,
      healthStatus: "idle",
    },
  }
}

describe("Batch D — builder store", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useBuilderStore.setState({
      workspaceId: "ws-1",
      workspaceName: "Test",
      workspaceStatus: "DRAFT",
      isLoading: false,
      loadError: null,
      nodes: [],
      edges: [],
      skills: [],
      isDirty: true,
      isSaving: false,
      lastSavedAt: null,
      lastSavedState: null,
      hasDraftRecovery: false,
      draftTimestamp: null,
      _draftIntervalId: null,
      snapshots: [],
      isLoadingSnapshots: false,
      heartbeatSchedule: { frequency: "off", time: "08:00" },
      selectedAgentId: null,
      selectedEdgeId: null,
    })
  })

  describe("D1 skillIds persist on agent create", () => {
    it("create POST includes skillIds so selected skills survive save", async () => {
      const posts: Array<{ url: string; body: Record<string, unknown> }> = []
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = (init?.method || "GET").toUpperCase()
        if (method === "PATCH" && url.includes("/api/workspaces/ws-1")) {
          return jsonResponse({ success: true })
        }
        if (method === "GET" && url.endsWith("/api/agents/ws-1")) {
          return jsonResponse({ success: true, data: [] })
        }
        if (method === "POST" && url.endsWith("/api/agents/ws-1")) {
          const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
          posts.push({ url, body })
          return jsonResponse({ success: true, data: { id: "agent-real-1" } }, 201)
        }
        if (method === "GET" && url.includes("/api/connections/")) {
          return jsonResponse({ success: true, data: [] })
        }
        if (method === "POST" && url.includes("/snapshots")) {
          return jsonResponse({ success: true })
        }
        return jsonResponse({ success: true })
      })

      useBuilderStore.setState({ nodes: [tempWorker(["skill-a", "skill-b"])] })
      await useBuilderStore.getState().saveWorkspace()

      expect(posts).toHaveLength(1)
      expect(posts[0].body.skillIds).toEqual(["skill-a", "skill-b"])
    })

    it("reload shape: loadWorkspace maps agent skills onto agentSkillIds", async () => {
      global.fetch = vi.fn(async () =>
        jsonResponse({
          success: true,
          data: {
            id: "ws-1",
            name: "Test",
            status: "DRAFT",
            updatedAt: new Date().toISOString(),
            agents: [
              {
                id: "agent-1",
                name: "Researcher",
                role: "WORKER",
                color: "#8BFCAE",
                model: "anthropic/claude-sonnet-4-6",
                soulMd: "",
                agentsMd: "",
                positionX: 80,
                positionY: 220,
                skills: [
                  {
                    skillId: "skill-a",
                    skill: {
                      id: "skill-a",
                      name: "Research",
                      slug: "research",
                      category: "ops",
                      description: "",
                    },
                  },
                ],
              },
            ],
            connections: [],
          },
        }),
      )

      await useBuilderStore.getState().loadWorkspace("ws-1")
      const node = useBuilderStore.getState().nodes[0]
      expect(node.data.agentSkillIds).toEqual(["skill-a"])
      expect(node.data.skillCount).toBe(1)
    })

    it("MUTATION: omit skillIds from create POST → reload-shape guard fails", () => {
      const src = readFileSync(join(ROOT, "src/stores/builder-store.ts"), "utf8")
      const createStart = src.indexOf('method: "POST", headers: { "Content-Type": "application/json" }')
      expect(createStart).toBeGreaterThanOrEqual(0)
      // First POST in saveWorkspace is agent create (connections POST is later).
      const createBlock = src.slice(createStart, createStart + 450)
      expect(createBlock).toContain("skillIds")
      expect(createBlock).toContain("agentSkillIds")
    })
  })

  describe("D2 version-restore failure clears loading", () => {
    it("success:false → isLoading false and throws for mutateWithFeedback", async () => {
      global.fetch = vi.fn(async () =>
        jsonResponse({ success: false, error: { message: "Restore denied" } }),
      )
      useBuilderStore.setState({ isLoading: false })

      await expect(
        useBuilderStore.getState().restoreSnapshot("snap-1"),
      ).rejects.toThrow(/Restore denied|Failed to restore/)

      expect(useBuilderStore.getState().isLoading).toBe(false)
    })

    it("MUTATION: loading left stuck on success:false → fail", () => {
      const src = readFileSync(join(ROOT, "src/stores/builder-store.ts"), "utf8")
      const restoreStart = src.indexOf("restoreSnapshot: async")
      const restoreBlock = src.slice(restoreStart, restoreStart + 900)
      expect(restoreBlock).toMatch(/if\s*\(\s*!json\.success\s*\)/)
      expect(restoreBlock).toContain("isLoading: false")
      expect(restoreBlock).toContain("throw")
    })
  })

  describe("D3 builder load 5xx sets loadError", () => {
    it("workspace 500 → loadError 500, loading cleared, nodes empty", async () => {
      global.fetch = vi.fn(async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ success: false }),
          text: async () => "boom",
        }) as Response,
      )

      await useBuilderStore.getState().loadWorkspace("ws-1")
      const s = useBuilderStore.getState()
      expect(s.isLoading).toBe(false)
      expect(s.loadError).toBe(500)
      expect(s.nodes).toEqual([])
    })
  })

  describe("heartbeat picker — armed MD cron must not load as Off", () => {
    it("null heartbeatFrequency + HEARTBEAT.md cron → frequency times", async () => {
      global.fetch = vi.fn(async () =>
        jsonResponse({
          success: true,
          data: {
            id: "ws-1",
            name: "Armed",
            status: "RUNNING",
            timezone: "UTC",
            updatedAt: new Date().toISOString(),
            agents: [
              {
                id: "orch-1",
                name: "Commander",
                role: "ORCHESTRATOR",
                color: "#8BFCAE",
                model: "anthropic/claude-sonnet-4-6",
                soulMd: "",
                agentsMd: "",
                heartbeatFrequency: null,
                heartbeatTime: null,
                heartbeatMd: `- cron: "0 8 * * *"\n- cron: "0 21 * * *"\n`,
                positionX: 300,
                positionY: 40,
                skills: [],
              },
            ],
            connections: [],
            containerState: { heartbeatCronExpressions: null },
          },
        }),
      )

      await useBuilderStore.getState().loadWorkspace("ws-1")
      const hb = useBuilderStore.getState().heartbeatSchedule
      expect(hb.frequency).toBe("times")
      expect(hb.frequency).not.toBe("off")
      expect(hb.frequency).not.toBe("custom")
    })

    it('MUTATION: load path restores frequency: savedFreq || "off" without custom detection → fail', () => {
      const src = readFileSync(join(ROOT, "src/stores/builder-store.ts"), "utf8")
      expect(src).toContain("resolvePickerHeartbeatSchedule")
      // Buggy fallthrough that lies for MD-armed claws.
      expect(src).not.toMatch(/frequency:\s*savedFreq\s*\|\|\s*"off"/)
    })
  })
})
