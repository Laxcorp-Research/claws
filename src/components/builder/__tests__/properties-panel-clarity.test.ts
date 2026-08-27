import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const panel = readFileSync(
  join(process.cwd(), "src/components/builder/properties-panel.tsx"),
  "utf8",
)
const store = readFileSync(
  join(process.cwd(), "src/stores/builder-store.ts"),
  "utf8",
)

describe("PropertiesPanel workspace vs agent clarity", () => {
  it("MUTATION: Properties - prefix on agent header → fail", () => {
    expect(panel).not.toContain("Properties -")
    expect(panel).not.toContain("Properties \u2014")
    const header = panel.slice(
      panel.indexOf("const agent = selectedNode.data"),
      panel.indexOf("Role"),
    )
    expect(header).toContain("{agent.name}")
  })

  it("MUTATION: Jump to settings / Cursor entry copy restored → fail", () => {
    expect(panel).not.toContain("Jump to settings")
    expect(panel).not.toMatch(/Cursor entry/i)
    expect(panel).toContain("Not editable here")
  })

  it("MUTATION: workflow knobs on Commander/Critic agent panel → fail", () => {
    const knobsHits = panel.match(/<WorkflowKnobsPanel/g)
    expect(knobsHits).toHaveLength(1)
    const knobsIdx = panel.indexOf("<WorkflowKnobsPanel")
    const agentViewIdx = panel.indexOf("const agent = selectedNode.data")
    expect(knobsIdx).toBeGreaterThan(-1)
    expect(knobsIdx).toBeLessThan(agentViewIdx)
    expect(panel).not.toContain("(isOrch || isCritic) && <WorkflowKnobsPanel")
  })

  it("MUTATION: jumpToWorkflowKnobs / focusWorkflowKnobs revived → fail", () => {
    expect(store).not.toContain("jumpToWorkflowKnobs")
    expect(store).not.toContain("focusWorkflowKnobs")
    expect(store).not.toContain("clearFocusWorkflowKnobs")
    expect(panel).not.toContain("jumpToWorkflowKnobs")
  })
})
