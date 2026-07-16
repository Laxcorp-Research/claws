/**
 * Tool customization PR-2 — Step-2 / Manage Tools UI.
 *
 * MUTATION: always-disconnect (ignore checkbox) → unchecked-preserves test fails.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1", n: "2" }),
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("mode=manage"),
}))

vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: () => ({
    modalOpen: false,
    redeploying: false,
    status: null,
    lastStage: null,
    error: null,
    startRedeploy: vi.fn(),
    closeModal: vi.fn(),
    retry: vi.fn(),
  }),
}))

vi.mock("@/components/dashboard/redeploy-progress-modal", () => ({
  RedeployProgressModal: () => null,
}))

vi.mock("@/lib/oauth/disconnect-oauth-tool", () => ({
  disconnectOauthTool: vi.fn().mockResolvedValue(undefined),
}))

import SetupStepPage from "@/app/setup/[workspaceId]/step/[n]/page"
import { disconnectOauthTool } from "@/lib/oauth/disconnect-oauth-tool"

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const REQUIRED = [
  {
    slug: "twitter-api",
    name: "Twitter/X API",
    category: "Social",
    connectionType: "API_KEY" as const,
    required: true,
    customized: false,
  },
]
const RECOMMENDED = [
  {
    slug: "tavily",
    name: "Tavily",
    category: "Research",
    connectionType: "API_KEY" as const,
    required: false,
    customized: false,
  },
]

describe("Tool customization UI (Manage Tools)", () => {
  let lastPatchBody: { op?: string; slug?: string } | null
  let connections: Array<{
    toolSlug: string
    status: string
    id: string
    displayName: string
    connectionType: string
    hasCredentials?: boolean
  }>

  beforeEach(() => {
    vi.clearAllMocks()
    lastPatchBody = null
    connections = [
      {
        toolSlug: "twitter-api",
        status: "CONNECTED",
        id: "conn-tw",
        displayName: "Twitter/X API",
        connectionType: "API_KEY",
        hasCredentials: true,
      },
    ]

    let required = [...REQUIRED]
    let recommended = [...RECOMMENDED]

    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/tool-requirements/dependents")) {
        return jsonResponse({
          success: true,
          data: {
            hits: [
              {
                agentId: "a1",
                agentName: "Trend Scout",
                agentSlug: "trend",
                kind: "prose",
                details: ["twitter-api"],
              },
            ],
            labels: ["Trend Scout (mentioned in SOUL/AGENTS)"],
            honestLimitCopy: "Listed agents mention this tool in text only.",
            coverage: "prose",
          },
        })
      }
      if (href.includes("/tool-requirements") && init?.method === "PATCH") {
        lastPatchBody = JSON.parse(String(init.body ?? "{}")) as {
          op?: string
          slug?: string
        }
        if (lastPatchBody.op === "demote" && lastPatchBody.slug === "twitter-api") {
          required = []
          recommended = [
            {
              ...REQUIRED[0],
              required: false,
              customized: true,
            },
            ...RECOMMENDED,
          ]
        }
        if (lastPatchBody.op === "dismiss" && lastPatchBody.slug === "tavily") {
          recommended = recommended.filter((t) => t.slug !== "tavily")
        }
        if (lastPatchBody.op === "remove") {
          required = required.filter((t) => t.slug !== lastPatchBody!.slug)
          recommended = recommended.filter((t) => t.slug !== lastPatchBody!.slug)
        }
        if (lastPatchBody.op === "restore" && lastPatchBody.slug === "twitter-api") {
          required = [...REQUIRED]
          recommended = [...RECOMMENDED]
        }
        return jsonResponse({
          success: true,
          data: { tools: [...required, ...recommended], required, recommended, source: "workspace" },
        })
      }
      if (href.includes("/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: {
            tools: [...required, ...recommended],
            required,
            recommended,
            source: "workspace",
          },
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({
          success: true,
          data: { id: "ws-1", status: "DRAFT", clawTemplate: { slug: "twitter-growth-machine" } },
        })
      }
      if (href.includes("/api/tools/ws-1/") && init?.method === "DELETE") {
        connections = connections.filter((c) => !href.includes(c.id))
        return jsonResponse({ success: true, data: { deleted: true } })
      }
      if (href.includes("/api/tools/ws-1")) {
        return jsonResponse({
          success: true,
          data: { connections, customConnections: [], composioOAuthAvailable: true },
        })
      }
      if (href.includes("/api/deploy/")) {
        return jsonResponse({
          success: true,
          data: { workspaceStatus: "DRAFT", drift: { isStale: false, changedAreas: [] } },
        })
      }
      return jsonResponse({ success: true, data: {} })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("demotes required twitter into Recommended with Restore", async () => {
    render(<SetupStepPage />)
    expect(await screen.findByText("Twitter/X API")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Make optional" }))
    await waitFor(() => expect(lastPatchBody).toEqual({ op: "demote", slug: "twitter-api" }))
    await waitFor(() => expect(screen.getByText(/Was required/)).toBeDefined())
    expect(screen.getByRole("button", { name: "Restore" })).toBeDefined()
  })

  it("dismiss removes recommended tavily from the list", async () => {
    render(<SetupStepPage />)
    // Catalog display name (not seed snapshot name).
    expect(await screen.findByText("Tavily (Web Search)")).toBeDefined()
    // PR-3: unconnected recommended → × only (no Remove on that row).
    expect(screen.getByRole("button", { name: "Dismiss Tavily (Web Search)" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Tavily (Web Search)" }))
    await waitFor(() => expect(lastPatchBody).toEqual({ op: "dismiss", slug: "tavily" }))
    await waitFor(() => expect(screen.queryByText("Tavily (Web Search)")).toBeNull())
  })

  it("REMOVE dialog checkbox defaults ON; unchecked preserves credentials", async () => {
    render(<SetupStepPage />)
    expect(await screen.findByText("Twitter/X API")).toBeDefined()
    const rowRemove = screen.getAllByRole("button", { name: "Remove" })[0]
    fireEvent.click(rowRemove)

    expect(await screen.findByRole("heading", { name: /Remove Twitter\/X API/ })).toBeDefined()
    expect(screen.getByText("Trend Scout (mentioned in SOUL/AGENTS)")).toBeDefined()
    const checkbox = screen.getByLabelText(/Also disconnect and delete saved credentials/) as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    // Uncheck → requirement-set removal only; DELETE must not fire.
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    const confirmButtons = screen.getAllByRole("button", { name: "Remove" })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(lastPatchBody).toEqual({ op: "remove", slug: "twitter-api" }))
    // MUTATION: if confirm always disconnects, this fails.
    const deleteCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) =>
        String(call[0]).includes("/api/tools/ws-1/conn-tw") &&
        (call[1] as RequestInit | undefined)?.method === "DELETE",
    )
    expect(deleteCalls).toHaveLength(0)
    expect(disconnectOauthTool).not.toHaveBeenCalled()
    expect(connections.some((c) => c.toolSlug === "twitter-api")).toBe(true)
  })
})
