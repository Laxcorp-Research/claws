// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentLiveTile } from "@/components/dashboard/agent-live-tile"
import type { AgentLiveView, LiveOpsAgent } from "@/components/dashboard/live-ops-utils"

afterEach(() => cleanup())

function agent(role: LiveOpsAgent["role"] = "WORKER"): LiveOpsAgent {
  return {
    id: role.toLowerCase(),
    name: role === "WORKER" ? "Worker" : role === "ORCHESTRATOR" ? "Orchestrator" : "Critic",
    role,
    color: "#8BFCAE",
    model: "anthropic/claude-sonnet-4-6",
    agentSlug: role.toLowerCase(),
  }
}

function view(role: LiveOpsAgent["role"] = "WORKER"): AgentLiveView {
  return { agent: agent(role), state: { kind: "idle" } }
}

describe("AgentLiveTile controls", () => {
  it("renders pause/resume controls for Workers", () => {
    render(<AgentLiveTile view={view("WORKER")} onPauseAgent={() => {}} onResumeAgent={() => {}} />)
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined()
  })

  it("renders no controls for Orchestrator or Critic", () => {
    const onPause = vi.fn()
    const { rerender } = render(<AgentLiveTile view={view("ORCHESTRATOR")} onPauseAgent={onPause} onResumeAgent={() => {}} />)
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()

    rerender(<AgentLiveTile view={view("CRITIC")} onPauseAgent={onPause} onResumeAgent={() => {}} />)
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
  })

  it("shows pending copy instead of a false Paused state", () => {
    render(
      <AgentLiveTile
        view={{ agent: agent("WORKER"), state: { kind: "pause-pending" } }}
        onPauseAgent={() => {}}
        onResumeAgent={() => {}}
      />,
    )
    expect(screen.getByText("PAUSE-PENDING")).toBeDefined()
    expect(screen.getByText("Pause pending — redeploy to apply")).toBeDefined()
  })

  it("renders the agent name through truncation-ready text", () => {
    render(<AgentLiveTile view={view("WORKER")} onPauseAgent={() => {}} onResumeAgent={() => {}} />)
    expect(screen.getByText("Worker").className).toContain("text-ellipsis")
  })
})
