import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { deriveAllowAgents } from "@/lib/openclaw/derive-allow-agents"

const agents = [
  { id: "o", name: "Commander", role: "ORCHESTRATOR" },
  { id: "w1", name: "Researcher", role: "WORKER", isPaused: false },
  { id: "w2", name: "Writer", role: "WORKER", isPaused: true },
  { id: "w3", name: "Orphan", role: "WORKER", isPaused: false },
  { id: "c", name: "Quality Critic", role: "CRITIC" },
]

describe("deriveAllowAgents", () => {
  it("allowAgents = (edge targets − paused) ∪ {critic}", () => {
    const result = deriveAllowAgents({
      agents,
      edges: [
        { sourceAgentId: "o", targetAgentId: "w1" },
        { sourceAgentId: "o", targetAgentId: "w2" },
      ],
    })
    expect(result.allowAgents).toEqual(["researcher", "quality-critic"])
    expect(result.permittedWorkerIds).toEqual(["w1"])
    expect(result.criticId).toBe("quality-critic")
  })

  it("critic invariant: critic always present even with zero edges", () => {
    const result = deriveAllowAgents({ agents, edges: [] })
    expect(result.allowAgents).toEqual(["quality-critic"])
  })

  it("MUTATION: sever edge derivation → matrix fails", () => {
    const src = readFileSync(resolve(__dirname, "../derive-allow-agents.ts"), "utf8")
    expect(src).toContain("edge.sourceAgentId !== orch.id")
    expect(src).toContain("worker.isPaused")
    expect(src).toContain("allowAgentIds.push(criticId)")
  })

  it("MUTATION: drop critic → invariant fails", () => {
    const src = readFileSync(resolve(__dirname, "../derive-allow-agents.ts"), "utf8")
    expect(src).toMatch(/if \(criticId\)[\s\S]*allowAgentIds\.push\(criticId\)/)
  })
})
