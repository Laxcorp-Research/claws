// @vitest-environment jsdom
//
// Locks in the STOPPED branch added in the PR #52 follow-up:
//   - STOPPED shows "Open Dashboard" (pre-follow-up: hidden because
//     hasDeployment didn't include STOPPED)
//   - STOPPED shows "Redeploy" and clicking it routes to /dashboard/[id]
//     (the dashboard page owns the /cloud confirmation dialog from PR #52)
//   - STOPPED does NOT show Pause or the (now-removed) Resume items
//   - PAUSED no longer shows the Resume item (dead code after PR #52)
//   - Running path and Draft/Setup paths continue to work

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { WorkspaceContextMenu } from "@/components/my-claws/workspace-context-menu"

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockPush.mockReset()
})

function openMenu(status: string) {
  render(
    <WorkspaceContextMenu
      workspaceId="ws-1"
      workspaceName="Test Workspace"
      status={status}
      agentRoles={["ORCHESTRATOR", "WORKER", "CRITIC"]}
      isCreatorEnrolled={false}
      onRename={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByLabelText("Workspace options"))
}

describe("WorkspaceContextMenu — STOPPED branch (PR #52 follow-up)", () => {
  it("renders 'Open Dashboard' item for STOPPED workspaces", () => {
    openMenu("STOPPED")
    expect(screen.getByText("Open Dashboard")).toBeDefined()
  })

  it("renders 'Redeploy' item for STOPPED workspaces, and click routes to /dashboard/[id]", () => {
    openMenu("STOPPED")
    const redeploy = screen.getByText("Redeploy")
    expect(redeploy).toBeDefined()
    fireEvent.click(redeploy)
    expect(mockPush).toHaveBeenCalledWith("/dashboard/ws-1")
  })

  it("does NOT render Pause or Resume for STOPPED workspaces", () => {
    openMenu("STOPPED")
    expect(screen.queryByText("Pause")).toBeNull()
    expect(screen.queryByText("Resume")).toBeNull()
  })
})

describe("WorkspaceContextMenu — PAUSED branch (Resume item removed)", () => {
  it("does NOT render Resume for PAUSED workspaces (dead post-PR-#52)", () => {
    openMenu("PAUSED")
    expect(screen.queryByText("Resume")).toBeNull()
  })

  it("still renders 'Open Dashboard' for PAUSED workspaces", () => {
    openMenu("PAUSED")
    expect(screen.getByText("Open Dashboard")).toBeDefined()
  })

  it("does NOT render Pause for PAUSED (only RUNNING gets Pause)", () => {
    openMenu("PAUSED")
    expect(screen.queryByText("Pause")).toBeNull()
  })
})

describe("WorkspaceContextMenu — RUNNING branch (unchanged by this PR)", () => {
  it("renders 'Pause' for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.getByText("Pause")).toBeDefined()
  })

  it("does NOT render Redeploy for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.queryByText("Redeploy")).toBeNull()
  })

  it("renders 'Open Dashboard' for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.getByText("Open Dashboard")).toBeDefined()
  })
})

describe("WorkspaceContextMenu — pre-deploy branches (unchanged by this PR)", () => {
  it("DRAFT renders 'Setup & Deploy'", () => {
    openMenu("DRAFT")
    expect(screen.getByText("Setup & Deploy")).toBeDefined()
  })

  it("SETUP_INCOMPLETE renders 'Continue Setup'", () => {
    openMenu("SETUP_INCOMPLETE")
    expect(screen.getByText("Continue Setup")).toBeDefined()
  })

  it("DRAFT does NOT render 'Open Dashboard' (no deployment yet)", () => {
    openMenu("DRAFT")
    expect(screen.queryByText("Open Dashboard")).toBeNull()
  })
})
