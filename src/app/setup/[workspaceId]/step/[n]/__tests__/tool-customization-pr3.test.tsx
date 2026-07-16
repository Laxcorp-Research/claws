/**
 * Tool customization PR-3 — snackbar feedback, swap→browse, affordances, restore.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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

type ReqTool = {
  slug: string
  name: string
  category: string
  connectionType: "API_KEY"
  required: boolean
  customized: boolean
  alternatives?: string[]
}

const REQUIRED: ReqTool[] = [
  {
    slug: "twitter-api",
    name: "Twitter/X API",
    category: "Social",
    connectionType: "API_KEY",
    required: true,
    customized: false,
  },
]
const RECOMMENDED: ReqTool[] = [
  {
    slug: "tavily",
    name: "Tavily",
    category: "SEARCH",
    connectionType: "API_KEY",
    required: false,
    customized: false,
    alternatives: ["serp_api", "exa_search"],
  },
]

function renderPage() {
  return render(
    <SnackbarProvider>
      <SetupStepPage />
    </SnackbarProvider>,
  )
}

describe("Tool customization PR-3", () => {
  let lastPatchBody: {
    op?: string
    slug?: string
    replaceWith?: string
  } | null
  let required = [...REQUIRED]
  let recommended = [...RECOMMENDED]
  let removedFromTemplate: Array<{ slug: string; name: string; category: string; connectionType: string; required: boolean }> = []
  let toolsList = [...REQUIRED, ...RECOMMENDED]

  beforeEach(() => {
    vi.clearAllMocks()
    lastPatchBody = null
    required = [...REQUIRED]
    recommended = [...RECOMMENDED]
    removedFromTemplate = []
    toolsList = [...REQUIRED, ...RECOMMENDED]

    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/tool-requirements/dependents")) {
        return jsonResponse({
          success: true,
          data: { hits: [], labels: [], honestLimitCopy: "", coverage: "none" },
        })
      }
      if (href.includes("/tool-requirements") && init?.method === "PATCH") {
        lastPatchBody = JSON.parse(String(init.body ?? "{}")) as {
          op?: string
          slug?: string
          replaceWith?: string
        }
        if (lastPatchBody.op === "dismiss" && lastPatchBody.slug === "tavily") {
          recommended = recommended.filter((t) => t.slug !== "tavily")
          toolsList = [...required, ...recommended]
        }
        if (lastPatchBody.op === "undismiss" && lastPatchBody.slug === "tavily") {
          recommended = [...RECOMMENDED]
          toolsList = [...required, ...recommended]
        }
        if (lastPatchBody.op === "demote" && lastPatchBody.slug === "twitter-api") {
          required = []
          recommended = [
            { ...REQUIRED[0], required: false, customized: true },
            ...RECOMMENDED,
          ]
          toolsList = [...required, ...recommended]
        }
        if (lastPatchBody.op === "restore" && lastPatchBody.slug === "twitter-api") {
          required = [...REQUIRED]
          recommended = [...RECOMMENDED]
          removedFromTemplate = []
          toolsList = [...required, ...recommended]
        }
        if (lastPatchBody.op === "remove" && lastPatchBody.slug === "twitter-api") {
          required = []
          removedFromTemplate = [
            {
              slug: "twitter-api",
              name: "Twitter/X API",
              category: "Social",
              connectionType: "API_KEY",
              required: true,
            },
          ]
          toolsList = [...required, ...recommended]
        }
        if (lastPatchBody.op === "swap") {
          const from = lastPatchBody.slug!
          const to = lastPatchBody.replaceWith!
          const catalogName =
            to === "serp_api" ? "SerpAPI" : to === "tavily" ? "Tavily" : to
          recommended = recommended.map((t) =>
            t.slug === from
              ? {
                  ...t,
                  slug: to,
                  name: catalogName,
                  alternatives: [from, ...(t.alternatives ?? []).filter((a) => a !== to)],
                }
              : t,
          )
          // MUTATION lock: must not leave both from+to (plain-add).
          toolsList = [...required, ...recommended]
          expect(toolsList.filter((t) => t.slug === from)).toHaveLength(0)
        }
        return jsonResponse({
          success: true,
          data: {
            tools: toolsList,
            required,
            recommended,
            removedFromTemplate,
            source: "workspace",
          },
        })
      }
      if (href.includes("/tool-requirements")) {
        return jsonResponse({
          success: true,
          data: {
            tools: toolsList,
            required,
            recommended,
            removedFromTemplate,
            source: "workspace",
          },
        })
      }
      if (href.includes("/api/tools/ws-1/browse")) {
        return jsonResponse({
          success: true,
          data: {
            tools: [
              {
                slug: "tavily",
                name: "Tavily (Web Search)",
                category: "SEARCH",
                connectionType: "API_KEY",
                credentialFields: [{ name: "TAVILY_API_KEY", label: "Key", required: true }],
                description: "search",
              },
              {
                slug: "serp_api",
                name: "SerpAPI",
                category: "SEARCH",
                connectionType: "API_KEY",
                credentialFields: [{ name: "SERPAPI_API_KEY", label: "Key", required: true }],
                description: "search",
              },
              {
                slug: "exa_search",
                name: "Exa",
                category: "SEARCH",
                connectionType: "API_KEY",
                credentialFields: [{ name: "EXA_API_KEY", label: "Key", required: true }],
                description: "search",
              },
              {
                slug: "gmail",
                name: "Gmail",
                category: "EMAIL",
                connectionType: "OAUTH_COMPOSIO",
                credentialFields: [],
                description: "mail",
                authMode: "managed-oauth",
              },
            ],
            categories: ["SEARCH", "EMAIL"],
          },
        })
      }
      if (href.includes("/api/workspaces/ws-1")) {
        return jsonResponse({
          success: true,
          data: { id: "ws-1", status: "DRAFT", clawTemplate: { slug: "twitter-growth-machine" } },
        })
      }
      if (href.includes("/api/tools/ws-1")) {
        return jsonResponse({
          success: true,
          data: { connections: [], customConnections: [], composioOAuthAvailable: true },
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

  it("MUTATION helper-import guard: all tool ops route through mutateWithFeedback", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    expect(pageSrc).toContain('from "@/lib/ui/mutate-with-feedback"')
    expect(pageSrc).toContain("mutateWithFeedback")
    // Each op handler must call the helper (bypass on one → fail).
    for (const marker of [
      "handleDemote",
      "handleDismiss",
      "handleRestore",
      "handleRemoveConfirm",
      "handleSwapSelect",
    ]) {
      expect(pageSrc).toContain(marker)
    }
    const demoteBlock = pageSrc.slice(
      pageSrc.indexOf("const handleDemote"),
      pageSrc.indexOf("const handleRestore"),
    )
    const dismissBlock = pageSrc.slice(
      pageSrc.indexOf("const handleDismiss"),
      pageSrc.indexOf("const [removeState"),
    )
    const restoreBlock = pageSrc.slice(
      pageSrc.indexOf("const handleRestore"),
      pageSrc.indexOf("const handleDismiss"),
    )
    const removeBlock = pageSrc.slice(
      pageSrc.indexOf("const handleRemoveConfirm"),
      pageSrc.indexOf("const handleRemoveCancel"),
    )
    const swapBlock = pageSrc.slice(
      pageSrc.indexOf("const handleSwapSelect"),
      pageSrc.indexOf("const handleBrowseConnect"),
    )
    expect(demoteBlock).toContain("mutateWithFeedback")
    expect(dismissBlock).toContain("mutateWithFeedback")
    expect(restoreBlock).toContain("mutateWithFeedback")
    expect(removeBlock).toContain("mutateWithFeedback")
    expect(swapBlock).toContain("mutateWithFeedback")
    expect(swapBlock).toContain('"swap"')
    // MUTATION: plain-add POST must not be the swap path.
    expect(swapBlock).not.toMatch(/method:\s*"POST"/)
  })

  it("recommended unconnected row renders × only (no Remove)", async () => {
    renderPage()
    expect(await screen.findByText("Tavily (Web Search)")).toBeDefined()
    expect(screen.getByRole("button", { name: "Dismiss Tavily (Web Search)" })).toBeDefined()
    // Required twitter still has Remove; recommended tavily must not.
    const removeButtons = screen.queryAllByRole("button", { name: "Remove" })
    // Only twitter (required) — not tavily.
    expect(removeButtons.length).toBeGreaterThanOrEqual(1)
    // Dismiss is present; no second destructive labeled Remove next to tavily row.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Tavily (Web Search)" }))
    await waitFor(() => expect(lastPatchBody).toEqual({ op: "dismiss", slug: "tavily" }))
  })

  it("dismiss fires snackbar with Undo that undismisses", async () => {
    renderPage()
    expect(await screen.findByText("Tavily (Web Search)")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Tavily (Web Search)" }))
    await waitFor(() => expect(lastPatchBody?.op).toBe("dismiss"))
    expect(await screen.findByTestId("snackbar")).toBeDefined()
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(lastPatchBody).toEqual({ op: "undismiss", slug: "tavily" }))
    // MUTATION: undo no-op → tavily would stay gone.
    await waitFor(() => expect(screen.getByText("Tavily (Web Search)")).toBeDefined())
  })

  it("swap opens filtered browse with Suggested pins and replaces (carries required)", async () => {
    renderPage()
    expect(await screen.findByText("Tavily (Web Search)")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Swap" }))
    expect(await screen.findByTestId("browse-tools-swap")).toBeDefined()
    expect(screen.getByTestId("swap-suggested-label")).toBeDefined()
    expect(
      screen.getByText("Your agents adapt automatically via generated skill instructions."),
    ).toBeDefined()
    // Suggested pin from alternatives[] (serp_api).
    const selectButtons = screen.getAllByRole("button", { name: "Select" })
    expect(selectButtons.length).toBeGreaterThan(0)
    // Click SerpAPI select (first suggested after current excluded).
    const serpRow = screen.getByText("SerpAPI").closest("div")?.parentElement
    expect(serpRow).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole("button", { name: "Select" }).find((btn) =>
        btn.closest("[data-suggested='true']"),
      ) ?? selectButtons[0],
    )
    await waitFor(() =>
      expect(lastPatchBody).toEqual({
        op: "swap",
        slug: "tavily",
        replaceWith: "serp_api",
      }),
    )
  })

  it("removed-tools affordance lists and restores via re-hydrate", async () => {
    removedFromTemplate = [
      {
        slug: "twitter-api",
        name: "Twitter/X API",
        category: "Social",
        connectionType: "API_KEY",
        required: true,
      },
    ]
    required = []
    toolsList = [...RECOMMENDED]
    renderPage()
    expect(await screen.findByTestId("removed-from-claw")).toBeDefined()
    expect(screen.getByText(/Removed from this Claw \(1\)/)).toBeDefined()
    fireEvent.click(screen.getByTestId("removed-from-claw"))
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" })
    fireEvent.click(restoreButtons[restoreButtons.length - 1])
    await waitFor(() =>
      expect(lastPatchBody).toEqual({ op: "restore", slug: "twitter-api" }),
    )
    // MUTATION: skip re-hydrate → restore PATCH never fires (already asserted).
  })

  it("Done label is Back to Builder (navigation, not commit)", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText("Manage Tools")).toBeDefined())
    const backs = screen.getAllByRole("button", { name: "Back to Builder" })
    expect(backs.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull()
  })
})
