// @vitest-environment jsdom
//
// PR #4 Commit 9 — Browse Tools modal rendering contract.
//
// PR2.9-fix1 label updates:
//   - "Connect OAuth" → "Connect with OAuth"  for OAUTH_COMPOSIO + managed-oauth
//   - "Connect OAuth" → "Enter API key"        for OAUTH_COMPOSIO + byok-api-key
//   - "Connect" (direct API_KEY) → "Enter API key"  (alignment with BYOK label)
// Tests updated below.
//
// The bug this commit fixes (GH #39, moved into PR #4 scope) manifested
// in the modal: a Gmail row stayed on "Connect with OAuth" even after the
// backend had written the ToolConnection row to CONNECTED. The fix is
// in Step 2 (page.tsx) where connectedSlugs is now sourced from ALL
// ToolConnection rows, not just template-listed ones. This test locks
// the modal's own invariant: given a correct `connectedSlugs` prop, the
// rendering differentiates connected vs disconnected rows properly.
//
// We don't test the full "connect → poll → UI updates" flow here — that
// depends on the wizard page's state machine, which is tested via the
// pure helpers in tools-state.test.ts.

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { BrowseToolsModal } from "@/components/setup/browse-tools-modal"

const gmailCatalogTool = {
  slug: "gmail",
  name: "Gmail",
  connectionType: "OAUTH_COMPOSIO" as const,
  category: "EMAIL",
  description: "Send and read email",
  credentialFields: [],
}

const tavilyCatalogTool = {
  slug: "tavily",
  name: "Tavily (Web Search)",
  connectionType: "API_KEY" as const,
  category: "SEARCH",
  description: "AI-optimized web search",
  credentialFields: [{ envVar: "TAVILY_API_KEY", label: "API Key", required: true, primary: true }],
}

// PR2.9-fix1 Bug 1A fixture: an OAUTH_COMPOSIO toolkit classified as
// byok-api-key. Used to assert the modal renders "Enter API key" rather
// than "Connect with OAuth" at first paint.
const typefullyCatalogTool = {
  slug: "typefully",
  name: "Typefully",
  connectionType: "OAUTH_COMPOSIO" as const,
  category: "SOCIAL",
  composioToolkitId: "typefully",
  authMode: "byok-api-key" as const,
  description: "Twitter/X content scheduling",
  credentialFields: [],
}

const twitterCatalogTool = {
  slug: "twitter",
  name: "Twitter/X",
  connectionType: "OAUTH_COMPOSIO" as const,
  category: "SOCIAL",
  composioToolkitId: "twitter",
  authMode: "custom-oauth-required" as const,
  comingSoon: true,
  comingSoonReason: "OAuth app registration in progress with Twitter Developer",
  description: "Social media",
  credentialFields: [],
}

const liveApiKeyCatalogTool = {
  slug: "live-api-key-tool",
  name: "Live API Key Tool",
  connectionType: "OAUTH_COMPOSIO" as const,
  category: "LIVE",
  composioToolkitId: "live-api-key-tool",
  authMode: "byok-api-key" as const,
  description: "Live catalog API-key-only toolkit",
  credentialFields: [],
}

const noAuthCatalogTool = {
  slug: "hackernews",
  name: "Hacker News",
  connectionType: "OAUTH_COMPOSIO" as const,
  category: "NEWS",
  composioToolkitId: "hackernews",
  authMode: "none" as const,
  description: "Hacker News stories",
  credentialFields: [],
}

// The modal fetches /api/tools/{workspaceId}/browse on mount. We stub
// fetch globally with a response that matches our browse route's shape.
function stubBrowseFetch(tools: object[], categories: string[] = ["All", "EMAIL", "SEARCH"]) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: { tools, categories } }),
  }) as unknown as Response) as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("BrowseToolsModal — connected-state reflection", () => {
  beforeEach(() => {
    stubBrowseFetch([gmailCatalogTool, tavilyCatalogTool])
  })

  it("renders 'Connect with OAuth' for an OAuth tool NOT in connectedSlugs (PR2.9-fix1: managed-oauth label)", async () => {
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    // Wait for the fetched catalog to render (initial state shows "Loading tools…").
    await waitFor(() => {
      expect(screen.getByText("Gmail")).toBeDefined()
    })
    expect(screen.getByRole("button", { name: "Connect with OAuth" })).toBeDefined()
    expect(screen.queryByText("Connected")).toBeNull()
  })

  it("renders 'Connected' — NOT 'Connect with OAuth' — when the slug IS in connectedSlugs", async () => {
    // This is the specific assertion guarding GH #39's regression:
    // if the page's connectedSlugs correctly includes a non-template
    // connected slug, the modal MUST reflect that as Connected.
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={["gmail"]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    await waitFor(() => {
      expect(screen.getByText("Gmail")).toBeDefined()
    })
    expect(screen.getByText("Connected")).toBeDefined()
    // There should be NO "Connect with OAuth" button for Gmail — the row
    // is already connected. (There may still be one for other OAuth tools
    // in the list, but not in a row whose header text is "Gmail".)
    const connectOAuthButtons = screen.queryAllByRole("button", { name: "Connect with OAuth" })
    // The test catalog only has Gmail as OAuth, so zero "Connect with
    // OAuth" buttons across the rendered list when gmail is connected.
    expect(connectOAuthButtons).toHaveLength(0)
  })

  it("renders 'Connect' (API key) for an API_KEY tool not in connectedSlugs", async () => {
    // Sanity check that the API_KEY rendering path is unaffected by the
    // Commit 9 changes — only OAuth rows have the connected-vs-oauth
    // fork that was broken.
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    await waitFor(() => {
      expect(screen.getByText("Tavily (Web Search)")).toBeDefined()
    })
    // PR2.9-fix1: direct API_KEY label aligned to "Enter API key" to
    // match BYOK toolkits in the same modal — same user action, same
    // wording, no fresh inconsistency introduced by PR2.9.
    expect(screen.getByRole("button", { name: "Enter API key" })).toBeDefined()
  })

  it("PR2.9-fix1 (Bug 1A): renders 'Enter API key' (NOT 'Connect with OAuth') for OAUTH_COMPOSIO + byok-api-key toolkit", async () => {
    // The label-correctness fix. Pre-fix, the catalog's typefully entry
    // (OAUTH_COMPOSIO + authMode: byok-api-key) rendered "Connect OAuth"
    // — misleading because clicking it opens a key form, not an OAuth
    // popup. Now the catalog-sourced authMode drives the label at first
    // paint.
    //
    // Why typefully here: it's the canonical byok-api-key toolkit in our
    // catalog (one of the 9 BYOK-eligible entries from the PR2.9 audit).
    stubBrowseFetch([typefullyCatalogTool])
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    await waitFor(() => {
      expect(screen.getByText("Typefully")).toBeDefined()
    })
    // The row's button should read "Enter API key", NOT "Connect with
    // OAuth". This is what catches Bug 1A regressions.
    expect(screen.getByRole("button", { name: "Enter API key" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Connect with OAuth" })).toBeNull()
  })

  it("B2: renders custom-OAuth comingSoon tools visible with disabled Coming Soon badge", async () => {
    stubBrowseFetch([twitterCatalogTool])
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )

    await waitFor(() => expect(screen.getByText("Twitter/X")).toBeDefined())
    const badge = screen.getByText("Coming Soon")
    expect(badge).toBeDefined()
    // DS Tooltip replaces native title= on Coming Soon badges.
    expect(badge.getAttribute("title")).toBeNull()
    const trigger = badge.closest("[data-state]") ?? badge.parentElement!
    fireEvent.pointerMove(trigger, { pointerType: "mouse" })
    const tip = await screen.findByRole("tooltip")
    expect(tip.textContent ?? "").toContain("OAuth app registration in progress")
    expect(screen.queryByRole("button", { name: "Connect with OAuth" })).toBeNull()
  })

  it("B2: renders live API-key-only Composio tools as Enter API key", async () => {
    stubBrowseFetch([liveApiKeyCatalogTool])
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )

    await waitFor(() => expect(screen.getByText("Live API Key Tool")).toBeDefined())
    expect(screen.getByRole("button", { name: "Enter API key" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Connect with OAuth" })).toBeNull()
  })

  it("B2.1: renders no-auth live tools with Add and creates a connected row instantly", async () => {
    stubBrowseFetch([noAuthCatalogTool])
    const onConnect = vi.fn()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/tools/cmo0cr0z5000004l24n0z8j1w/browse")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { tools: [noAuthCatalogTool], categories: ["All", "NEWS"] },
          }),
        } as Response
      }
      if (href.includes("/api/tools/cmo0cr0z5000004l24n0z8j1w") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ success: true, data: { status: "CONNECTED" } }),
        } as Response
      }
      return { ok: true, json: async () => ({ success: true }) } as Response
    })
    render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={onConnect}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )

    await waitFor(() => expect(screen.getByText("Hacker News")).toBeDefined())
    fireEvent.click(screen.getByRole("button", { name: "Add" }))

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ slug: "hackernews" })))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tools/cmo0cr0z5000004l24n0z8j1w",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          toolSlug: "hackernews",
          displayName: "Hacker News",
          connectionType: "NO_AUTH",
        }),
      }),
    )
  })

  it("transition: same render, switching connectedSlugs flips the badge", async () => {
    // Guards the re-render path — prevents a future regression where a
    // memoized child stops honoring a changed `connectedSlugs` prop.
    const { rerender } = render(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={[]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    await waitFor(() => expect(screen.getByText("Gmail")).toBeDefined())
    expect(screen.getByRole("button", { name: "Connect with OAuth" })).toBeDefined()

    rerender(
      <BrowseToolsModal
        open={true}
        onClose={() => {}}
        connectedSlugs={["gmail"]}
        onConnect={() => {}}
        composioOAuthAvailable={true}
        onOAuthConnect={() => {}}
        workspaceId="cmo0cr0z5000004l24n0z8j1w"
      />,
    )
    expect(screen.getByText("Connected")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Connect with OAuth" })).toBeNull()
  })

  it("shows OAuth loading immediately and blocks double-click while initiate is pending", async () => {
    const onOAuthConnect = vi.fn()
    function Harness() {
      const [pending, setPending] = useState<string | null>(null)
      return (
        <BrowseToolsModal
          open={true}
          onClose={() => {}}
          connectedSlugs={[]}
          onConnect={() => {}}
          composioOAuthAvailable={true}
          onOAuthConnect={(tool) => {
            onOAuthConnect(tool)
            setPending(tool.slug)
          }}
          workspaceId="cmo0cr0z5000004l24n0z8j1w"
          pendingOAuthSlug={pending}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(screen.getByText("Gmail")).toBeDefined())

    const connect = screen.getByRole("button", { name: "Connect with OAuth" })
    fireEvent.click(connect)

    const loading = screen.getByRole("button", { name: "Connect with OAuth" })
    expect((loading as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(loading)

    expect(onOAuthConnect).toHaveBeenCalledTimes(1)
  })
})
