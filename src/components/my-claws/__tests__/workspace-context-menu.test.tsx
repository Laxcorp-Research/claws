// @vitest-environment jsdom
//
// Locks in the STOPPED branch added in the PR #52 follow-up:
//   - STOPPED shows "Open Dashboard" (pre-follow-up: hidden because
//     hasDeployment didn't include STOPPED)
//   - STOPPED shows "Open to redeploy" and clicking it routes to /dashboard/[id]
//     (the dashboard page owns the /cloud confirmation dialog from PR #52)
//   - STOPPED does NOT show Stop or the (now-removed) Resume items
//   - PAUSED no longer shows the Resume item (dead code after PR #52)
//   - Running path and Draft/Setup paths continue to work
//
// fix/pause-rename-to-stop: the workspace-level "Pause" was renamed to "Stop"
// (it always destroyed the container) and gated behind a ConfirmDialog. The
// RUNNING action now reads "Stop" and fires POST /stop ONLY after confirmation.

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { WorkspaceContextMenu } from "@/components/my-claws/workspace-context-menu"

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockPush.mockReset()
  mockRefresh.mockReset()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch
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

  it("renders 'Open to redeploy' item for STOPPED workspaces, and click routes to /dashboard/[id]", () => {
    openMenu("STOPPED")
    const redeploy = screen.getByText("Open to redeploy")
    expect(redeploy).toBeDefined()
    fireEvent.click(redeploy)
    expect(mockPush).toHaveBeenCalledWith("/dashboard/ws-1")
  })

  it("does NOT render Stop or Resume for STOPPED workspaces", () => {
    openMenu("STOPPED")
    expect(screen.queryByText("Stop")).toBeNull()
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

  it("does NOT render Stop for PAUSED (only RUNNING gets Stop)", () => {
    openMenu("PAUSED")
    expect(screen.queryByText("Stop")).toBeNull()
  })
})

describe("WorkspaceContextMenu — RUNNING branch (Pause renamed to Stop)", () => {
  it("renders 'Stop' (not 'Pause') for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.getByText("Stop")).toBeDefined()
    expect(screen.queryByText("Pause")).toBeNull()
  })

  it("does NOT render Open to redeploy for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.queryByText("Open to redeploy")).toBeNull()
  })

  it("renders 'Open Dashboard' for RUNNING workspaces", () => {
    openMenu("RUNNING")
    expect(screen.getByText("Open Dashboard")).toBeDefined()
  })
})

describe("WorkspaceContextMenu — Stop is confirm-gated (regression: no instant destructive fire)", () => {
  it("clicking 'Stop' opens the confirm dialog and does NOT call /stop on first click", () => {
    openMenu("RUNNING")
    fireEvent.click(screen.getByText("Stop"))

    // Dialog is shown…
    expect(screen.getByText("Stop this Claw?")).toBeDefined()
    // …but the destructive call has NOT fired yet.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("calls POST /stop only AFTER the user confirms in the dialog", async () => {
    openMenu("RUNNING")
    fireEvent.click(screen.getByText("Stop"))
    expect(global.fetch).not.toHaveBeenCalled()

    // Confirm button inside the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith("/api/deploy/ws-1/stop", { method: "POST" })
  })

  it("cancelling with 'Keep running' never calls /stop", () => {
    openMenu("RUNNING")
    fireEvent.click(screen.getByText("Stop"))
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }))

    expect(global.fetch).not.toHaveBeenCalled()
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
