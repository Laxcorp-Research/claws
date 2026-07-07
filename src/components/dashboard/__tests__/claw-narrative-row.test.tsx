// @vitest-environment jsdom
//
// PR-6: ClawNarrativeRow is the briefing's main line + drill-down. Guards:
// (1) collapsed shows only the narrative, (2) the chevron reveals the roster +
// activity, (3) per-agent Pause is enabled for Workers and disabled for the
// Orchestrator/Critic, (4) the cost section stays hidden until there's real
// spend.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ClawNarrativeRow, type RosterAgent } from "@/components/dashboard/claw-narrative-row"

afterEach(() => cleanup())

// Orchestrator deliberately named "Atlas" (not "Orchestrator") so the agent
// name doesn't collide with the role label rendered in the same row.
const agents: RosterAgent[] = [
  { id: "o1", name: "Atlas", role: "ORCHESTRATOR", status: "running", color: "#5BA1F5" },
  { id: "w1", name: "Worker A", role: "WORKER", status: "running", color: "#8BFCAE" },
]

function renderRow(overrides: Partial<React.ComponentProps<typeof ClawNarrativeRow>> = {}) {
  const handlers = {
    onPauseAgent: vi.fn(),
    onResumeAgent: vi.fn(),
    onRestartAgent: vi.fn(),
  }
  render(
    <ClawNarrativeRow
      clawName="Acme Outreach"
      status="RUNNING"
      tasksToday={47}
      tasksYesterday={39}
      agentsError={0}
      pendingReview={0}
      agents={agents}
      logs={[]}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe("ClawNarrativeRow", () => {
  it("renders the narrative collapsed, with the drill-down hidden", () => {
    renderRow()
    expect(screen.getByText("47 tasks handled today — up from 39 yesterday.")).toBeTruthy()
    expect(screen.queryByText("Worker A")).toBeNull()
    expect(screen.queryByText("Agents")).toBeNull()
  })

  it("expands on chevron click to reveal the roster", () => {
    renderRow()
    fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))
    expect(screen.getByText("Worker A")).toBeTruthy()
    expect(screen.getByText("Atlas")).toBeTruthy()
    expect(screen.queryByText("Recent activity")).toBeNull()
  })

  it("renders Pause only for Workers (wires the handler)", () => {
    const { onPauseAgent } = renderRow()
    fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))

    const pauseButtons = screen.getAllByRole("button", { name: "Pause" }) as HTMLButtonElement[]
    expect(pauseButtons).toHaveLength(1)

    fireEvent.click(pauseButtons[0])
    expect(onPauseAgent).toHaveBeenCalledWith("w1")
  })

  it("offers Resume for a paused Worker and Restart for an errored Worker", () => {
    const { onResumeAgent, onRestartAgent } = renderRow({
      agents: [
        { id: "w1", name: "Worker A", role: "WORKER", status: "paused", color: "#8BFCAE" },
        { id: "w2", name: "Worker B", role: "WORKER", status: "error", color: "#8BFCAE" },
      ],
    })
    fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
    fireEvent.click(screen.getByRole("button", { name: "Restart" }))
    expect(onResumeAgent).toHaveBeenCalledWith("w1")
    expect(onRestartAgent).toHaveBeenCalledWith("w2")
  })

  it("hides the cost section when there's no recorded spend", () => {
    renderRow({
      showCosts: true,
      agentCosts: [{ agentName: "Worker A", model: "Claude Sonnet 4.6", calls: 0, cost: 0 }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))
    expect(screen.queryByText("Cost per agent")).toBeNull()
  })

  it("shows the cost section for credit users once there is spend", () => {
    renderRow({
      showCosts: true,
      agentCosts: [{ agentName: "Worker A", model: "Claude Sonnet 4.6", calls: 12, cost: 1.4 }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Toggle Claw details" }))
    expect(screen.getByText("Cost per agent")).toBeTruthy()
    expect(screen.getByText("$1.40")).toBeTruthy()
  })
})
