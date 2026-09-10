import { describe, expect, it } from "vitest"
import type { Edge, Node } from "@xyflow/react"
import {
  deriveAutomaticPreviewEdges,
  evaluateConnectAttempt,
  isPreviewEdgeId,
} from "@/lib/openclaw/builder-topology"
import type { AgentNodeData, ConnectionEdgeData } from "@/stores/builder-store"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function node(id: string, role: AgentNodeData["role"], name = id): Node<AgentNodeData> {
  return {
    id,
    type: "agentNode",
    position: { x: 0, y: 0 },
    data: {
      agentId: id,
      name,
      role,
      color: "#000",
      model: "m",
      soulMd: "",
      agentsMd: "",
      skillCount: 0,
      agentSkillIds: [],
      hasHeartbeat: false,
      healthStatus: "idle",
    },
  }
}

describe("builder-topology", () => {
  const nodes = [
    node("o", "ORCHESTRATOR", "Commander"),
    node("w", "WORKER", "Writer"),
    node("c", "CRITIC", "Reviewer"),
  ]

  it("allows only Commander → Worker solid edges", () => {
    expect(
      evaluateConnectAttempt({
        sourceId: "o",
        targetId: "w",
        nodes,
        edges: [],
      }).ok,
    ).toBe(true)
  })

  it("rejects worker→critic with plain-language toast copy", () => {
    const result = evaluateConnectAttempt({
      sourceId: "w",
      targetId: "c",
      nodes,
      edges: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("Review is automatic")
    }
  })

  it("preview edges are dotted worker→critic and never persisted ids", () => {
    const previews = deriveAutomaticPreviewEdges(nodes)
    expect(previews).toHaveLength(1)
    expect(previews[0]!.source).toBe("w")
    expect(previews[0]!.target).toBe("c")
    expect(isPreviewEdgeId(previews[0]!.id)).toBe(true)
    expect(previews[0]!.style?.strokeDasharray).toBe("4 3")
  })

  it("MUTATION: canvas must wire isValidConnection + legend (bypass → fail)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/builder/agent-canvas.tsx"), "utf8")
    expect(src).toContain("isValidConnection")
    expect(src).toContain("EDGE_LEGEND_SOLID")
    expect(src).toContain("deriveAutomaticPreviewEdges")
    expect(src).toContain("tryConnect")
    expect(src).toContain("solidEdgeStyle")
    expect(src).not.toContain("animated: !prefersReducedMotion")
  })

  it("MUTATION: you drew this legend / animated solids restored → fail", () => {
    const legend = readFileSync(join(process.cwd(), "src/lib/openclaw/validate-topology.ts"), "utf8")
    const canvas = readFileSync(join(process.cwd(), "src/components/builder/agent-canvas.tsx"), "utf8")
    const node = readFileSync(join(process.cwd(), "src/components/builder/agent-node.tsx"), "utf8")
    expect(legend).not.toContain("you drew this")
    expect(legend).toContain("Delegates: Commander to worker")
    expect(legend).toContain("Review: automatic")
    expect(canvas).toContain("animated: false")
    expect(node).toContain("isConnectable={isOrchestrator}")
    expect(node).toContain("isConnectable={isWorker}")
  })

  it("MUTATION: properties panel must use formatWorkflowLawSection + contextNote (bypass → fail)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/builder/properties-panel.tsx"), "utf8")
    expect(src).toContain("formatWorkflowLawSection")
    expect(src).toContain("updateConnectionContextNote")
    expect(src).toContain("workflow-fence-card")
    expect(src).toContain("AUTONOMOUS_CONSENT_INTRO")
    expect(src).toContain("I consent")
    expect(src).not.toContain("AUTO_PROCEED_DISABLED_COPY")
    expect(src).not.toContain("CONDITION_OPTIONS")
  })

  it("typecheck: ConnectionEdgeData contextNote accepted on edges", () => {
    const edge: Edge<ConnectionEdgeData> = {
      id: "e1",
      source: "o",
      target: "w",
      data: { condition: "ON_COMPLETE", label: "Delegates", contextNote: "deep dives" },
    }
    expect(edge.data?.contextNote).toBe("deep dives")
  })
})
