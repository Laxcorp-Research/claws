/**
 * PR-5 acceptance: demote single-row, undo→Required after reconcile, remove→absent.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SnackbarProvider } from "@/components/shared/snackbar"

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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

type Entry = {
  slug: string
  name: string
  category: string
  connectionType: "API_KEY"
  required: boolean
  customized: boolean
  alternatives?: string[]
}

describe("Tool customization PR-5 acceptance", () => {
  let required: Entry[]
  let recommended: Entry[]
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
    required = [
      {
        slug: "twitter-api",
        name: "Twitter/X API",
        category: "Platform",
        connectionType: "API_KEY",
        required: true,
        customized: false,
      },
    ]
    recommended = [
      {
        slug: "tavily",
        name: "Tavily",
        category: "SEARCH",
        connectionType: "API_KEY",
        required: false,
        customized: false,
        alternatives: ["serp_api"],
      },
    ]
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

    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/tool-requirements/dependents")) {
        return jsonResponse({
          success: true,
          data: { hits: [], labels: [], honestLimitCopy: "", coverage: "none" },
        })
      }
      if (href.includes("/tool-requirements") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          op?: string
          slug?: string
        }
        if (body.op === "demote" && body.slug === "twitter-api") {
          required = []
          recommended = [
            {
              slug: "twitter-api",
              name: "Twitter/X API",
              category: "Platform",
              connectionType: "API_KEY",
              required: false,
              customized: true,
            },
            ...recommended.filter((t) => t.slug !== "twitter-api"),
          ]
        }
        if (body.op === "restore" && body.slug === "twitter-api") {
          required = [
            {
              slug: "twitter-api",
              name: "Twitter/X API",
              category: "Platform",
              connectionType: "API_KEY",
              required: true,
              customized: false,
            },
          ]
          recommended = recommended.filter((t) => t.slug !== "twitter-api")
        }
        if (body.op === "remove" && body.slug === "twitter-api") {
          required = required.filter((t) => t.slug !== "twitter-api")
          recommended = recommended.filter((t) => t.slug !== "twitter-api")
        }
        return jsonResponse({
          success: true,
          data: {
            tools: [...required, ...recommended],
            required,
            recommended,
            removedFromTemplate:
              body.op === "remove"
                ? [
                    {
                      slug: "twitter-api",
                      name: "Twitter/X API",
                      category: "Platform",
                      connectionType: "API_KEY",
                      required: true,
                    },
                  ]
                : [],
            source: "workspace",
          },
        })
      }
      if (href.includes("/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: {
            tools: [...required, ...recommended],
            required,
            recommended,
            removedFromTemplate: [],
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

  function renderPage() {
    return render(
      <SnackbarProvider>
        <SetupStepPage />
      </SnackbarProvider>,
    )
  }

  it("demote → single Twitter/X row in Recommended (connection decorates, no extra)", async () => {
    renderPage()
    expect(await screen.findByText("Twitter/X API")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Make optional" }))
    await waitFor(() => expect(screen.getByText(/Was required/)).toBeDefined())
    const rows = screen.getAllByText("Twitter/X API")
    expect(rows).toHaveLength(1)
    expect(screen.queryByText("Additional tools")).toBeNull()
  })

  it("demote → Undo → Restored to Required tools snackbar and Required section", async () => {
    renderPage()
    expect(await screen.findByText("Twitter/X API")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Make optional" }))
    await waitFor(() => expect(screen.getByText(/Was required/)).toBeDefined())
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() =>
      expect(screen.getByText("Restored to Required tools")).toBeDefined(),
    )
    await waitFor(() => expect(screen.queryByText(/Was required/)).toBeNull())
    expect(screen.getByRole("button", { name: "Make optional" })).toBeDefined()
  })

  it("remove → reconcile leaves twitter absent from Required/Recommended", async () => {
    renderPage()
    expect(await screen.findByText("Twitter/X API")).toBeDefined()
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(await screen.findByRole("heading", { name: /Remove Twitter\/X API/ })).toBeDefined()
    // Confirm stays loading/disabled until dependents resolve — click before that is a no-op.
    expect(await screen.findByText("No labeled agent dependents found.")).toBeDefined()
    const confirmButtons = screen.getAllByRole("button", { name: "Remove" })
    const confirm = confirmButtons[confirmButtons.length - 1]
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryByRole("button", { name: "Make optional" })).toBeNull())
    await waitFor(() => expect(screen.queryByText(/Was required/)).toBeNull())
    // Connection deleted with default "Also disconnect" — not an Additional row.
    await waitFor(() => expect(screen.queryByText("Additional tools")).toBeNull())
    expect(connections.some((c) => c.toolSlug === "twitter-api")).toBe(false)
  })
})
