// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

const mockLoadWorkspace = vi.fn()
const mockSaveWorkspace = vi.fn()
const storeState = {
  loadWorkspace: mockLoadWorkspace,
  workspaceName: "Sales Claw",
  workspaceStatus: "RUNNING",
  isDirty: false,
  isSaving: false,
  isLoading: false,
  loadError: null as number | null,
  lastSavedAt: null as Date | null,
  saveWorkspace: mockSaveWorkspace,
  revertToLastSaved: vi.fn(),
  hasDraftRecovery: false,
  draftTimestamp: null as number | null,
  restoreDraft: vi.fn(),
  dismissDraft: vi.fn(),
}

const getState = vi.fn(() => ({ isDirty: false, setWorkspaceName: vi.fn() }))
function mockUseBuilderStore() {
  return storeState
}
mockUseBuilderStore.getState = getState
vi.mock("@/stores/builder-store", () => ({ useBuilderStore: mockUseBuilderStore }))

const mockStartRedeploy = vi.fn()
vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: vi.fn(() => ({
    modalOpen: false,
    redeploying: false,
    status: null,
    lastStage: null,
    error: null,
    startRedeploy: mockStartRedeploy,
    closeModal: vi.fn(),
    retry: vi.fn(),
  })),
}))

vi.mock("@/components/builder/agent-canvas", () => ({ AgentCanvas: () => <div>Canvas</div> }))
vi.mock("@/components/builder/agent-sidebar", () => ({ AgentSidebar: () => <div>Sidebar</div> }))
vi.mock("@/components/builder/properties-panel", () => ({ PropertiesPanel: () => <div>Properties</div> }))
vi.mock("@/components/builder/heartbeat-config", () => ({ HeartbeatConfig: () => <div>Heartbeat</div> }))
vi.mock("@/components/builder/version-history-panel", () => ({ VersionHistoryPanel: () => null }))

import BuilderPage from "@/app/builder/[workspaceId]/page"
import { useWorkspaceRedeploy } from "@/components/dashboard/use-workspace-redeploy"

function mockDriftResponse(stale: boolean, changedAreas: string[] = ["tools"]) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const href = String(url)
    if (href.includes("/api/deploy/ws-1/status?drift=1")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            workspaceStatus: "RUNNING",
            drift: { isStale: stale, changedAreas },
          },
        }),
      } as Response
    }
    return { ok: true, json: async () => ({ success: true }) } as Response
  })
}

describe("BuilderPage drift banner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeState.workspaceStatus = "RUNNING"
    storeState.isDirty = false
    storeState.lastSavedAt = null
    mockSaveWorkspace.mockResolvedValue(undefined)
    mockDriftResponse(false)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders the dashboard-style drift banner on mount when RUNNING and stale", async () => {
    mockDriftResponse(true, ["tools", "agents"])

    render(<BuilderPage />)

    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: tools, agents")).toBeDefined()
  })

  it("does not render the drift banner when fresh", async () => {
    mockDriftResponse(false)

    render(<BuilderPage />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText("Configuration changed since last deploy — redeploy to apply")).toBeNull()
  })

  it("appears after a config save flips drift stale and Redeploy uses the shared flow", async () => {
    let stale = false
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url)
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              workspaceStatus: "RUNNING",
              drift: { isStale: stale, changedAreas: ["workspace"] },
            },
          }),
        } as Response
      }
      return { ok: true, json: async () => ({ success: true }) } as Response
    })
    storeState.isDirty = true
    mockSaveWorkspace.mockImplementation(async () => { stale = true })

    render(<BuilderPage />)
    fireEvent.click(screen.getByRole("button", { name: /Save/i }))

    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Redeploy" }))
    expect(useWorkspaceRedeploy).toHaveBeenCalled()
    expect(mockStartRedeploy).toHaveBeenCalledTimes(1)
  })
})
