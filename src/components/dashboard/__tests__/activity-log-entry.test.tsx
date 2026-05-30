// @vitest-environment jsdom
//
// PR-4: the activity feed entry shows a short `message` and, when there's a
// `detail` that says MORE than the message, a click-to-expand affordance.
// These guard: (1) no expand when detail is absent/equal, (2) expand toggles
// the full detail, (3) the detail text is rendered verbatim on expand.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ActivityLogEntry } from "@/components/dashboard/activity-log-entry"

afterEach(() => cleanup())

describe("ActivityLogEntry expand affordance", () => {
  it("renders no expand button when detail is absent", () => {
    render(<ActivityLogEntry timestamp="08:00" agentName="Orchestrator" agentColor="#fff" message="Heartbeat check" />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Heartbeat check")).toBeTruthy()
  })

  it("renders no expand button when detail equals the message", () => {
    render(
      <ActivityLogEntry timestamp="08:00" agentName="Orch" agentColor="#fff" message="Task completed" detail="Task completed" />,
    )
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("renders an expand button when detail says more, and toggles the detail body", () => {
    render(
      <ActivityLogEntry
        timestamp="08:00"
        agentName="Orchestrator"
        agentColor="#fff"
        message="Heartbeat check"
        detail="[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly."
      />,
    )
    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    // collapsed: full detail not yet rendered
    expect(screen.queryByText(/Read HEARTBEAT\.md and follow it strictly\./)).toBeNull()

    fireEvent.click(button)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText(/Read HEARTBEAT\.md and follow it strictly\./)).toBeTruthy()

    // collapses again
    fireEvent.click(button)
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText(/Read HEARTBEAT\.md and follow it strictly\./)).toBeNull()
  })
})
