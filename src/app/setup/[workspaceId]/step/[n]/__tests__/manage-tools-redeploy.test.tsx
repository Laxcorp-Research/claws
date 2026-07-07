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
const mockUseWorkspaceRedeploy = vi.fn((args: RedeployHookArgs) => {
  void args
  return {
    modalOpen: false,
    redeploying: false,
    status: null,
    lastStage: null,
    error: null,
    startRedeploy: mockStartRedeploy,
    closeModal: vi.fn(),
    retry: vi.fn(),
  }
})
vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: (args: RedeployHookArgs) => mockUseWorkspaceRedeploy(args),
}))

vi.mock("@/components/dashboard/redeploy-progress-modal", () => ({
  RedeployProgressModal: ({ open }: { open: boolean }) => open ? <div>Shared redeploy modal</div> : null,
}))

import SetupStepPage from "@/app/setup/[workspaceId]/step/[n]/page"

type TestCustomConnection = {
  id: string
  slug: string
  name: string
  baseUrl: string
  authType: "API_KEY_HEADER" | "BEARER_TOKEN" | "BASIC_AUTH" | "QUERY_PARAM"
  description: string | null
  createdAt: string
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response
}

describe("Manage Tools apply changes redeploy", () => {
  let customConnections: TestCustomConnection[]
  let deployStatusData: { workspaceStatus: string; drift: { isStale: boolean; changedAreas: string[] } }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStartRedeploy.mockResolvedValue(undefined)
    customConnections = []
    deployStatusData = {
      workspaceStatus: "RUNNING",
      drift: { isStale: true, changedAreas: ["tools"] },
    }
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/tools/ws-1/custom") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          name?: string
          baseUrl?: string
          authType?: TestCustomConnection["authType"]
          description?: string
        }
        customConnections = [
          {
            id: "cust-1",
            slug: "custom-internal-crm",
            name: body.name ?? "Internal CRM",
            baseUrl: body.baseUrl ?? "https://crm.example.com/v1",
            authType: body.authType ?? "API_KEY_HEADER",
            description: body.description ?? null,
            createdAt: "2026-07-06T10:00:00.000Z",
          },
        ]
        deployStatusData = {
          workspaceStatus: "RUNNING",
          drift: { isStale: true, changedAreas: ["tools"] },
        }
        return jsonResponse({ success: true, data: customConnections[0] })
      }
      if (href.includes("/api/tools/ws-1/custom/cust-1") && init?.method === "DELETE") {
        customConnections = []
        deployStatusData = {
          workspaceStatus: "RUNNING",
          drift: { isStale: true, changedAreas: ["tools"] },
        }
        return jsonResponse({ success: true, data: { deleted: true } })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({
          success: true,
          data: { id: "ws-1", status: "RUNNING", clawTemplate: null },
        })
      }
      if (href.includes("/api/tools/ws-1")) {
        return jsonResponse({
          success: true,
          data: { connections: [], customConnections, composioOAuthAvailable: true },
        })
      }
      if (href.includes("/api/deploy/ws-1/status?drift=1")) {
        return jsonResponse({
          success: true,
          data: deployStatusData,
        })
      }
      return jsonResponse({ success: true })
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

  it("renders saved custom APIs and deletes them through the custom API route", async () => {
    customConnections = [
      {
        id: "cust-1",
        slug: "custom-internal-crm",
        name: "Internal CRM",
        baseUrl: "https://crm.example.com/v1",
        authType: "API_KEY_HEADER",
        description: "Lookup customer renewals.",
        createdAt: "2026-07-06T10:00:00.000Z",
      },
    ]

    render(<SetupStepPage />)

    expect(await screen.findByText("Custom APIs")).toBeDefined()
    expect(screen.getByText("Internal CRM")).toBeDefined()
    expect(screen.getByText("crm.example.com · API key header")).toBeDefined()
    expect(screen.getByText("Saved — redeploy to apply")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.queryByText("Internal CRM")).toBeNull())
    expect(global.fetch).toHaveBeenCalledWith("/api/tools/ws-1/custom/cust-1", { method: "DELETE" })
  })

  it("refetches after saving a custom API and opens the drift redeploy prompt on Done", async () => {
    render(<SetupStepPage />)

    await waitFor(() => expect(screen.getByText("Manage Tools")).toBeDefined())
    fireEvent.click(screen.getByRole("button", { name: "+ Connect custom API" }))
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Test & save" })).toBeNull()

    fireEvent.change(screen.getByPlaceholderText("e.g., Our Internal CRM"), {
      target: { value: "Internal CRM" },
    })
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), {
      target: { value: "https://crm.example.com/v1" },
    })
    fireEvent.change(screen.getByPlaceholderText("Your API key or token"), {
      target: { value: "crm-secret-key" },
    })
    fireEvent.change(screen.getByPlaceholderText("Describe what this API does..."), {
      target: { value: "Lookup customer renewals." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Internal CRM")).toBeDefined()
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tools/ws-1/custom",
      expect.objectContaining({ method: "POST" }),
    )

    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(await screen.findByText("Apply changes now?")).toBeDefined()
    expect(screen.getByText("Your Claw is running an older configuration. Redeploy to apply changes to tools.")).toBeDefined()
  })
})
