// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPush = vi.fn()
const mockReplace = vi.fn()
let searchParamsString = "mode=manage&from=builder"
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1", n: "2" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
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

type TestTemplateTool = {
  slug: string
  name: string
  category: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "NO_AUTH"
  required: boolean
  alternatives?: string[]
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
  let workspaceTemplateSlug: string | null
  let templateTools: { required: TestTemplateTool[]; recommended: TestTemplateTool[] }
  let deployStatusData: { workspaceStatus: string; drift: { isStale: boolean; changedAreas: string[] } }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsString = "mode=manage&from=builder"
    mockStartRedeploy.mockResolvedValue(undefined)
    customConnections = []
    workspaceTemplateSlug = null
    templateTools = { required: [], recommended: [] }
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
      if (href.includes("/api/workspaces/ws-1/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: {
            tools: [...templateTools.required, ...templateTools.recommended],
            required: templateTools.required,
            recommended: templateTools.recommended,
            source: "workspace",
          },
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({
          success: true,
          data: {
            id: "ws-1",
            status: "RUNNING",
            clawTemplate: workspaceTemplateSlug ? { slug: workspaceTemplateSlug } : null,
          },
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
    // Primary CTA (not the TextLink) — both say "Back to Builder" (nav, not commit).
    const backButtons = screen.getAllByRole("button", { name: "Back to Builder" })
    fireEvent.click(backButtons[backButtons.length - 1])

    expect(await screen.findByText("Apply changes now?")).toBeDefined()
    const redeployButtons = screen.getAllByRole("button", { name: "Redeploy" })
    fireEvent.click(redeployButtons[redeployButtons.length - 1])

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

  it("renders an overlapping required/recommended template tool once under Required", async () => {
    workspaceTemplateSlug = "social-template"
    templateTools = {
      required: [
        {
          slug: "twitter-api",
          name: "Twitter/X API",
          category: "SOCIAL",
          connectionType: "API_KEY",
          required: true,
        },
      ],
      recommended: [
        {
          slug: "twitter-api",
          name: "Twitter/X API",
          category: "SOCIAL",
          connectionType: "API_KEY",
          required: false,
        },
        {
          slug: "tavily",
          name: "Tavily (Web Search)",
          category: "SEARCH",
          connectionType: "API_KEY",
          required: false,
        },
      ],
    }

    render(<SetupStepPage />)

    expect(await screen.findByText("Required tools")).toBeDefined()
    expect(screen.getAllByText("Twitter/X API")).toHaveLength(1)

    const requiredSection = screen.getByText("Required tools").closest("div")
    const recommendedSection = screen.getByText("Recommended tools").closest("div")

    expect(requiredSection).not.toBeNull()
    expect(recommendedSection).not.toBeNull()
    expect(within(requiredSection!).getByText("Twitter/X API")).toBeDefined()
    expect(within(recommendedSection!).queryByText("Twitter/X API")).toBeNull()
    expect(within(recommendedSection!).getByText("Tavily (Web Search)")).toBeDefined()
  })

  it("refetches after saving a custom API and opens the drift redeploy prompt on Done", async () => {
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: false, changedAreas: [] } }
    render(<SetupStepPage />)

    await waitFor(() => expect(screen.getByText("Manage Tools")).toBeDefined())
    expect(screen.queryByText("Configuration changed since last deploy — redeploy to apply")).toBeNull()
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
    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: tools")).toBeDefined()
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tools/ws-1/custom",
      expect.objectContaining({ method: "POST" }),
    )

    const backButtons = screen.getAllByRole("button", { name: "Back to Builder" })
    fireEvent.click(backButtons[backButtons.length - 1])
    expect(await screen.findByText("Apply changes now?")).toBeDefined()
    expect(screen.getByText("Your Claw is running an older configuration. Redeploy to apply changes to tools.")).toBeDefined()
  })

  it("wizard step 2 shows the generic drift banner after a custom API save and routes CTA to Deploy", async () => {
    searchParamsString = ""
    deployStatusData = { workspaceStatus: "RUNNING", drift: { isStale: false, changedAreas: [] } }
    render(<SetupStepPage />)

    await waitFor(() => expect(screen.getByText("Connect your tools")).toBeDefined())
    expect(screen.queryByText("Configuration changed since last deploy — redeploy to apply")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "+ Connect custom API" }))
    fireEvent.change(screen.getByPlaceholderText("e.g., Our Internal CRM"), {
      target: { value: "Internal CRM" },
    })
    fireEvent.change(screen.getByPlaceholderText("https://api.example.com/v1"), {
      target: { value: "https://crm.example.com/v1" },
    })
    fireEvent.change(screen.getByPlaceholderText("Your API key or token"), {
      target: { value: "crm-secret-key" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("Changed: tools")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Go to deploy" }))
    expect(mockPush).toHaveBeenCalledWith("/setup/ws-1/step/4")
  })
})
