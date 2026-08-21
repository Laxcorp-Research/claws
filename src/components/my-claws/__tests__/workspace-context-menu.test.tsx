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

import { describe, it, expect, afterEach, vi, beforeEach, beforeAll } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { WorkspaceContextMenu } from "@/components/my-claws/workspace-context-menu"
import {
  installRadixPointerPolyfills,
  openWorkspaceOptionsMenu,
} from "./radix-menu-test-utils"

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

beforeAll(() => {
  installRadixPointerPolyfills()
})

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
  openWorkspaceOptionsMenu()
}

describe("WorkspaceContextMenu - STOPPED branch (PR #52 follow-up)", () => {
  it("renders 'Open Dashboard' item for STOPPED workspaces", async () => {
    openMenu("STOPPED")
    expect(await screen.findByText("Open Dashboard")).toBeDefined()
  })

  it("renders 'Open to redeploy' item for STOPPED workspaces, and click routes to /dashboard/[id]", async () => {
    openMenu("STOPPED")
    const redeploy = await screen.findByText("Open to redeploy")
    fireEvent.click(redeploy)
    expect(mockPush).toHaveBeenCalledWith("/dashboard/ws-1")
  })

  it("does NOT render Stop or Resume for STOPPED workspaces", async () => {
    openMenu("STOPPED")
    await screen.findByText("Open Dashboard")
    expect(screen.queryByRole("menuitem", { name: "Stop" })).toBeNull()
    expect(screen.queryByText("Resume")).toBeNull()
  })
})

describe("WorkspaceContextMenu - PAUSED branch (Resume item removed)", () => {
  it("does NOT render Resume for PAUSED workspaces (dead post-PR-#52)", async () => {
    openMenu("PAUSED")
    await screen.findByText("Open Dashboard")
    expect(screen.queryByText("Resume")).toBeNull()
  })

  it("still renders 'Open Dashboard' for PAUSED workspaces", async () => {
    openMenu("PAUSED")
    expect(await screen.findByText("Open Dashboard")).toBeDefined()
  })

  it("does NOT render Stop for PAUSED (only RUNNING gets Stop)", async () => {
    openMenu("PAUSED")
    await screen.findByText("Open Dashboard")
    expect(screen.queryByRole("menuitem", { name: "Stop" })).toBeNull()
  })
})

describe("WorkspaceContextMenu - RUNNING branch (Pause renamed to Stop)", () => {
  it("renders 'Stop' (not 'Pause') for RUNNING workspaces", async () => {
    openMenu("RUNNING")
    expect(await screen.findByRole("menuitem", { name: "Stop" })).toBeDefined()
    expect(screen.queryByText("Pause")).toBeNull()
  })

  it("does NOT render Open to redeploy for RUNNING workspaces", async () => {
    openMenu("RUNNING")
    await screen.findByRole("menuitem", { name: "Stop" })
    expect(screen.queryByText("Open to redeploy")).toBeNull()
  })

  it("renders 'Open Dashboard' for RUNNING workspaces", async () => {
    openMenu("RUNNING")
    expect(await screen.findByText("Open Dashboard")).toBeDefined()
  })
})

describe("WorkspaceContextMenu - Stop is confirm-gated (regression: no instant destructive fire)", () => {
  it("clicking 'Stop' opens the confirm dialog and does NOT call /stop on first click", async () => {
    openMenu("RUNNING")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stop" }))

    expect(await screen.findByText("Stop this Claw?")).toBeDefined()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("calls POST /stop only AFTER the user confirms in the dialog", async () => {
    openMenu("RUNNING")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stop" }))
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Stop" }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith("/api/deploy/ws-1/stop", { method: "POST" })
  })

  it("cancelling with 'Keep running' never calls /stop", async () => {
    openMenu("RUNNING")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stop" }))
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }))

    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("WorkspaceContextMenu - pre-deploy branches (unchanged by this PR)", () => {
  it("DRAFT renders 'Setup & Deploy'", async () => {
    openMenu("DRAFT")
    expect(await screen.findByText("Setup & Deploy")).toBeDefined()
  })

  it("SETUP_INCOMPLETE renders 'Continue Setup'", async () => {
    openMenu("SETUP_INCOMPLETE")
    expect(await screen.findByText("Continue Setup")).toBeDefined()
  })

  it("DRAFT does NOT render 'Open Dashboard' (no deployment yet)", async () => {
    openMenu("DRAFT")
    await screen.findByText("Setup & Deploy")
    expect(screen.queryByText("Open Dashboard")).toBeNull()
  })
})
