// @vitest-environment jsdom
/**
 * Batch B: Stop patches local row status; snackbar "Claw stopped".
 * MUTATION: omit onStopped → list stays Running → fail.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { WorkspaceContextMenu } from "@/components/my-claws/workspace-context-menu"
import {
  installRadixPointerPolyfills,
  openWorkspaceOptionsMenu,
} from "./radix-menu-test-utils"

const show = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show }),
}))

beforeAll(() => {
  installRadixPointerPolyfills()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  show.mockReset()
})

describe("WorkspaceContextMenu Stop reconcile (Batch B)", () => {
  it("calls onStopped with STOPPED from server + snackbar Claw stopped", async () => {
    const onStopped = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { stopped: true, status: "STOPPED" } }),
        }),
      ) as unknown as typeof fetch,
    )

    render(
      <WorkspaceContextMenu
        workspaceId="ws-1"
        workspaceName="Test"
        status="RUNNING"
        agentRoles={["ORCHESTRATOR"]}
        isCreatorEnrolled={false}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onStopped={onStopped}
      />,
    )

    openWorkspaceOptionsMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stop" }))
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }))

    await waitFor(() => {
      expect(onStopped).toHaveBeenCalledWith("ws-1", "STOPPED")
    })
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Claw stopped" }),
    )
  })

  it("MUTATION: without onStopped the stop still succeeds but reconcile is skipped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ success: true, data: { stopped: true, status: "STOPPED" } }),
        }),
      ) as unknown as typeof fetch,
    )

    render(
      <WorkspaceContextMenu
        workspaceId="ws-1"
        workspaceName="Test"
        status="RUNNING"
        agentRoles={["ORCHESTRATOR"]}
        isCreatorEnrolled={false}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    openWorkspaceOptionsMenu()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Stop" }))
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }))
    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Claw stopped" }),
      )
    })
  })
})
