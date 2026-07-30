import { describe, expect, it } from "vitest"
import {
  TOPOLOGY_NO_WORKER_COPY,
  validateTopology,
} from "@/lib/openclaw/validate-topology"

const agents = [
  { id: "o", name: "Commander", role: "ORCHESTRATOR" },
  { id: "w1", name: "Worker A", role: "WORKER" },
  { id: "w2", name: "Worker B", role: "WORKER" },
  { id: "c", name: "Critic", role: "CRITIC" },
]

describe("validateTopology", () => {
  it("hard: zero orch→worker edges", () => {
    const result = validateTopology({ agents, edges: [] })
    expect(result.ok).toBe(false)
    expect(result.hardErrors.some((e) => e.code === "NO_ORCH_WORKER_EDGES")).toBe(true)
    expect(result.hardErrors.find((e) => e.code === "NO_ORCH_WORKER_EDGES")?.message).toBe(
      TOPOLOGY_NO_WORKER_COPY,
    )
  })

  it("hard: critic missing", () => {
    const result = validateTopology({
      agents: agents.filter((a) => a.role !== "CRITIC"),
      edges: [{ sourceAgentId: "o", targetAgentId: "w1" }],
    })
    expect(result.ok).toBe(false)
    expect(result.hardErrors.some((e) => e.code === "CRITIC_MISSING")).toBe(true)
  })

  it("hard: illegal worker→critic edge", () => {
    const result = validateTopology({
      agents,
      edges: [
        { sourceAgentId: "o", targetAgentId: "w1" },
        { sourceAgentId: "w1", targetAgentId: "c" },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.hardErrors.some((e) => e.code === "ILLEGAL_EDGE")).toBe(true)
  })

  it("soft: orphaned worker named", () => {
    const result = validateTopology({
      agents,
      edges: [{ sourceAgentId: "o", targetAgentId: "w1" }],
    })
    expect(result.ok).toBe(true)
    expect(result.softWarnings).toEqual([
      expect.objectContaining({
        code: "ORPHANED_WORKER",
        workerName: "Worker B",
      }),
    ])
  })

  it("ok: linear orch→worker + critic present", () => {
    const result = validateTopology({
      agents: agents.filter((a) => a.id !== "w2"),
      edges: [{ sourceAgentId: "o", targetAgentId: "w1" }],
    })
    expect(result.ok).toBe(true)
    expect(result.softWarnings).toEqual([])
  })
})
