// @vitest-environment jsdom
//
// a11y fix (GH #127-adjacent): agent names must render in --tx (readable in
// both themes), NOT in the agent's identity hue (the pale worker greens/salmon
// were ~1.2:1 as text on white). The color survives only as a decorative dot.
// Mutation guard: revert a name to style={{ color: agent.color }} and the
// "no inline color on the name" assertion fails.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ClawNarrativeRow, type RosterAgent } from "@/components/dashboard/claw-narrative-row"
import { ActivityLogEntry } from "@/components/dashboard/activity-log-entry"

afterEach(() => cleanup())

const WORKER_HUE = "#8BFCAE"

const agents: RosterAgent[] = [
  { id: "w1", name: "Worker A", role: "WORKER", status: "running", color: WORKER_HUE },
]

function renderRowExpanded() {
  render(
    <ClawNarrativeRow
      clawName="Acme"
      status="RUNNING"
      tasksToday={1}
      tasksYesterday={0}
      agentsError={0}
      pendingReview={0}
      agents={agents}
      logs={[]}
      onPauseAgent={() => {}}
      onResumeAgent={() => {}}
      onRestartAgent={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))
}

describe("agent name readability (WCAG AA)", () => {
  it("roster: name uses --tx and has NO inline color (hue lives on the dot)", () => {
    renderRowExpanded()
    const name = screen.getByText("Worker A")
    expect(name.className).toContain("text-[var(--tx)]")
    expect(name.style.color).toBe("")
    // The identity hue is still present as a decorative dot near the name.
    const dot = name.parentElement?.querySelector("span[style]") as HTMLElement | null
    expect(dot).not.toBeNull()
    expect(dot!.style.backgroundColor).not.toBe("")
  })

  it("activity log: agent name uses --tx and has NO inline color", () => {
    render(
      <ActivityLogEntry
        timestamp="14:10:00 UTC"
        agentName="Worker A"
        agentColor={WORKER_HUE}
        message="did a thing"
      />,
    )
    const name = screen.getByText("Worker A")
    expect(name.className).toContain("text-[var(--tx)]")
    expect(name.style.color).toBe("")
    const dot = name.querySelector("span[style]") as HTMLElement | null
    expect(dot).not.toBeNull()
    expect(dot!.style.backgroundColor).not.toBe("")
  })
})
