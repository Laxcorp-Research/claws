// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPush = vi.fn()
const mockReplace = vi.fn()
const searchParams = new URLSearchParams("mode=manage&from=builder")
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1", n: "2" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => searchParams,
}))

const mockStartRedeploy = vi.fn()
type RedeployHookArgs = { onCompleted?: () => void }
const mockUseWorkspaceRedeploy = vi.fn((_: RedeployHookArgs) => ({
  modalOpen: false,
  redeploying: false,
  status: null,
  lastStage: null,
  error: null,
  startRedeploy: mockStartRedeploy,
  closeModal: vi.fn(),
  retry: vi.fn(),
}))
vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: (args: RedeployHookArgs) => mockUseWorkspaceRedeploy(args),
}))

vi.mock("@/components/dashboard/redeploy-progress-modal", () => ({
  RedeployProgressModal: ({ open }: { open: boolean }) => open ? <div>Shared redeploy modal</div> : null,
}))

import SetupStepPage from "@/app/setup/[workspaceId]/step/[n]/page"

describe("Manage Tools apply changes redeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartRedeploy.mockResolvedValue(undefined)
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url)
      if (href.includes("/api/workspaces/ws-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: "ws-1", status: "RUNNING", clawTemplate: null },
          }),
        } as Response
      }
      if (href.includes("/api/tools/ws-1")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { connections: [], customConnections: [], composioOAuthAvailable: true },
          }),
        } as Response
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              workspaceStatus: "RUNNING",
              drift: { isStale: true, changedAreas: ["tools"] },
            },
          }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("uses the shared redeploy flow from Apply changes instead of a bare redeploy fetch", async () => {
    render(<SetupStepPage />)

    await waitFor(() => expect(screen.getByText("Manage Tools")).toBeDefined())
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(await screen.findByText("Apply changes now?")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Redeploy" }))

    expect(mockUseWorkspaceRedeploy).toHaveBeenCalled()
    expect(mockStartRedeploy).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalledWith("/api/deploy/ws-1/redeploy", { method: "POST" })

    const hookArgs = mockUseWorkspaceRedeploy.mock.calls[0][0] as RedeployHookArgs
    hookArgs.onCompleted!()
    expect(mockPush).toHaveBeenCalledWith("/dashboard/ws-1?redeployed=changes-applied")
  })
})
