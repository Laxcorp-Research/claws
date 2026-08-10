import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import {
  evaluateWorkspaceDeployTopologyPrerequisites,
  omitLegacyPersistedReviewEdges,
} from "@/lib/openclaw/deploy-topology-prerequisites"
import { validateTopology } from "@/lib/openclaw/validate-topology"

/** Card 18 prod canary shape: orch→workers + 4 legacy worker→critic edges. */
const CANARY_AGENTS = [
  { id: "orch", name: "Commander", role: "ORCHESTRATOR" },
  { id: "w1", name: "Writer", role: "WORKER" },
  { id: "w2", name: "Scout", role: "WORKER" },
  { id: "w3", name: "Engagement", role: "WORKER" },
  { id: "w4", name: "Analytics", role: "WORKER" },
  { id: "crit", name: "Reviewer", role: "CRITIC" },
]

const CANARY_EDGES = [
  { sourceAgentId: "orch", targetAgentId: "w1" },
  { sourceAgentId: "orch", targetAgentId: "w2" },
  { sourceAgentId: "orch", targetAgentId: "w3" },
  { sourceAgentId: "orch", targetAgentId: "w4" },
  { sourceAgentId: "w1", targetAgentId: "crit" },
  { sourceAgentId: "w2", targetAgentId: "crit" },
  { sourceAgentId: "w3", targetAgentId: "crit" },
  { sourceAgentId: "w4", targetAgentId: "crit" },
]

describe("omitLegacyPersistedReviewEdges", () => {
  it("Card-18 canary: raw validateTopology hard-fails; omit → ok", () => {
    const raw = validateTopology({ agents: CANARY_AGENTS, edges: CANARY_EDGES })
    expect(raw.ok).toBe(false)
    expect(raw.hardErrors.some((e) => e.code === "ILLEGAL_EDGE")).toBe(true)

    const { edges, ignored } = omitLegacyPersistedReviewEdges({
      agents: CANARY_AGENTS,
      edges: CANARY_EDGES,
    })
    expect(ignored).toBe(4)
    expect(validateTopology({ agents: CANARY_AGENTS, edges }).ok).toBe(true)
  })

  it("MUTATION: skipping omit leaves canary illegal", () => {
    // Documents the refusing gate that stranded the paying redeploy.
    expect(
      validateTopology({ agents: CANARY_AGENTS, edges: CANARY_EDGES }).ok,
    ).toBe(false)
  })
})

describe("evaluateWorkspaceDeployTopologyPrerequisites", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("STOPPED + subscribed canary shape → topology ok (legacy review edges ignored)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      agents: CANARY_AGENTS,
      connections: CANARY_EDGES,
    })

    const result = await evaluateWorkspaceDeployTopologyPrerequisites("ws-canary")
    expect(result.ok).toBe(true)
    expect(result.ignoredLegacyReviewEdges).toBe(4)
    expect(result.hardErrors).toEqual([])
    expect(result.primaryMessage).toBeNull()
  })

  it("still hard-blocks when no orch→worker edges remain after omit", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      agents: CANARY_AGENTS,
      connections: [
        { sourceAgentId: "w1", targetAgentId: "crit" },
        { sourceAgentId: "w2", targetAgentId: "crit" },
      ],
    })

    const result = await evaluateWorkspaceDeployTopologyPrerequisites("ws-broken")
    expect(result.ok).toBe(false)
    expect(result.hardErrors.some((e) => e.code === "NO_ORCH_WORKER_EDGES")).toBe(true)
  })
})
