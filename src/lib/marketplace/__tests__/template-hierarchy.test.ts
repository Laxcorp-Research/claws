import { describe, expect, it } from "vitest"
import { parseTemplateHierarchy, STORE_HIERARCHY_LEGEND } from "@/lib/marketplace/template-hierarchy"

describe("parseTemplateHierarchy", () => {
  it("accepts a JSON string snapshot", () => {
    const parsed = parseTemplateHierarchy(
      JSON.stringify({
        agents: [
          { name: "Lead", agentSlug: "lead", role: "ORCHESTRATOR", color: "#5BA1F5" },
          { name: "Scout", agentSlug: "scout", role: "WORKER", color: "#8BFCAE" },
        ],
        connections: [{ sourceSlug: "lead", targetSlug: "scout" }],
      }),
    )
    expect(parsed?.orchestrator.name).toBe("Lead")
    expect(parsed?.workers).toHaveLength(1)
    expect(parsed?.solidWorkerKeys).toEqual(["scout"])
  })

  it("returns null without an orchestrator", () => {
    expect(
      parseTemplateHierarchy({
        agents: [{ name: "Scout", role: "WORKER", color: "#8BFCAE" }],
      }),
    ).toBeNull()
  })

  it("exports the store legend copy", () => {
    expect(STORE_HIERARCHY_LEGEND).toBe("solid = configured · dotted = automatic")
  })
})
