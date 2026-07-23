import { describe, expect, it } from "vitest"
import { workspaceMatchesFilter } from "@/lib/my-claws/workspace-filters"

describe("workspaceMatchesFilter", () => {
  it("All matches any status", () => {
    expect(workspaceMatchesFilter("running", "All")).toBe(true)
    expect(workspaceMatchesFilter("hibernated", "All")).toBe(true)
  })

  it("Sleeping maps to hibernated badge status", () => {
    expect(workspaceMatchesFilter("hibernated", "Sleeping")).toBe(true)
    expect(workspaceMatchesFilter("running", "Sleeping")).toBe(false)
    expect(workspaceMatchesFilter("stopped", "Sleeping")).toBe(false)
  })

  it("other pills match badge status lowercase", () => {
    expect(workspaceMatchesFilter("running", "Running")).toBe(true)
    expect(workspaceMatchesFilter("paused", "Paused")).toBe(true)
    expect(workspaceMatchesFilter("error", "Error")).toBe(true)
    expect(workspaceMatchesFilter("draft", "Draft")).toBe(true)
    expect(workspaceMatchesFilter("setup", "Setup")).toBe(true)
    expect(workspaceMatchesFilter("running", "Paused")).toBe(false)
  })
})
