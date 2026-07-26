// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkspaceCard } from "@/components/my-claws/workspace-card"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

afterEach(() => cleanup())

const base = {
  id: "cmpnvr35x0000vshq8vhoirc3",
  name: "WIRE-TEST-2026-05-27-1346",
  agentCount: 2,
  agentRoles: ["ORCHESTRATOR"],
  source: "Custom",
  isCreatorEnrolled: false,
  onRename: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
}

describe("WorkspaceCard — sticky heartbeat visibility", () => {
  it("WIRE-TEST-shaped STOPPED sticky shows quiet Heartbeat missed line", () => {
    render(
      <WorkspaceCard
        {...base}
        status="stopped"
        apiStatus="STOPPED"
        heartbeatMissedAt="2026-07-19T09:17:03.182Z"
      />,
    )
    expect(screen.getByText(/Heartbeat missed/)).toBeTruthy()
  })

  it("renders for hibernated status matrix row", () => {
    render(
      <WorkspaceCard
        {...base}
        status="hibernated"
        apiStatus="HIBERNATED"
        heartbeatMissedAt="2026-07-25T16:08:18.000Z"
      />,
    )
    expect(screen.getByText(/Heartbeat missed/)).toBeTruthy()
  })

  it("renders for running status matrix row", () => {
    render(
      <WorkspaceCard
        {...base}
        status="running"
        apiStatus="RUNNING"
        heartbeatMissedAt="2026-07-26T08:10:00.000Z"
      />,
    )
    expect(screen.getByText(/Heartbeat missed/)).toBeTruthy()
  })

  it("omits line when heartbeatMissedAt is null", () => {
    render(
      <WorkspaceCard
        {...base}
        status="stopped"
        apiStatus="STOPPED"
        heartbeatMissedAt={null}
      />,
    )
    expect(screen.queryByText(/Heartbeat missed/)).toBeNull()
  })
})
