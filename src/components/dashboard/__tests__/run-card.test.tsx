// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RunCard } from "@/components/dashboard/run-card"
import type { MissionRunCard } from "@/components/dashboard/mission-log-utils"

afterEach(() => cleanup())

function item(overrides: Partial<MissionRunCard> = {}): MissionRunCard {
  return {
    kind: "run",
    id: "run-1",
    runId: "run-1",
    status: "success",
    agentName: "Worker",
    agentSlug: "worker",
    agentColor: "#8BFCAE",
    taskName: "Write brief",
    startedAt: "2026-07-07T12:00:00.000Z",
    endedAt: "2026-07-07T12:00:06.000Z",
    durationMs: 6000,
    channelId: "slack",
    routine: false,
    pageBoundaryCut: false,
    events: [
      {
        id: "start",
        timestamp: "2026-07-07T12:00:00.000Z",
        agentName: "Worker",
        agentSlug: "worker",
        action: "Write brief",
        detail: null,
        actionType: "TASK_START",
        channelId: "slack",
        runId: "run-1",
      },
    ],
    ...overrides,
  }
}

describe("RunCard", () => {
  it("renders terminal success outcome and duration", () => {
    render(<RunCard item={item()} />)

    expect(screen.getByText("✓")).toBeDefined()
    expect(screen.getByText("6s")).toBeDefined()
    expect(screen.getByText("via Slack")).toBeDefined()
  })

  it("renders an open run spinner", () => {
    render(<RunCard item={item({ status: "open", endedAt: null, durationMs: null })} />)

    expect(screen.getByLabelText("Open run")).toBeDefined()
    expect(screen.getByText("running")).toBeDefined()
  })

  it("renders routine runs muted with a Routine badge", () => {
    render(<RunCard item={item({ routine: true })} />)

    const card = screen.getByLabelText("Run Write brief")
    expect(card.className).toContain("bg-[var(--bg2)]")
    expect(screen.getByText("Routine")).toBeDefined()
  })
})
