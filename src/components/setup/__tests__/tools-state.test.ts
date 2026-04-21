// PR #4 Commit 9 — unit tests for the Setup Wizard Step 2 state helpers.
//
// The bug this commit fixes (GH #39, moved into PR #4 scope) was that
// `Step2.tools` was seeded from template required/recommended names only,
// and every mutator was `setTools(prev.map(...))`. A ToolConnection the
// user created for a tool NOT in the workspace template never made it
// into state, so the `connectedSlugs` memo was blind to it and the
// Browse Tools modal kept rendering "Connect OAuth" for an already-
// CONNECTED row.
//
// These tests lock the helpers that fix that:
//   1. connectionUiState — DB status → UI tri-state mapping (was inline
//      in page.tsx, now shared / tested).
//   2. buildExtraToolState — turns a single non-template DB row into a
//      ToolState entry with extra=true.
//   3. buildExtraToolsFromConnections — the merge function the page calls
//      in initial-load AND refreshTools to append non-template rows.
//      Must skip already-represented slugs, de-dupe, and exclude AI
//      providers (those live on Step 1).

import { describe, it, expect } from "vitest"
import {
  connectionUiState,
  buildExtraToolState,
  buildExtraToolsFromConnections,
  type ServerConnectionSummary,
  type ToolState,
} from "@/components/setup/tools-state"

function conn(overrides: Partial<ServerConnectionSummary> = {}): ServerConnectionSummary {
  return {
    toolSlug: "gmail",
    status: "CONNECTED",
    id: "cmo82zvik000004kwfjvc3sfy",
    displayName: "Gmail",
    connectionType: "OAUTH_COMPOSIO",
    lastError: null,
    createdAt: "2026-04-20T22:15:48.620Z",
    ...overrides,
  }
}

describe("connectionUiState", () => {
  it("maps CONNECTED to { status: 'connected' }", () => {
    expect(connectionUiState(conn({ status: "CONNECTED" }))).toEqual({ status: "connected" })
  })

  it("un-collapses EXPIRED and REVOKED (PR #4 Commit 6 contract)", () => {
    expect(connectionUiState(conn({ status: "EXPIRED" }))).toEqual({ status: "expired" })
    expect(connectionUiState(conn({ status: "REVOKED" }))).toEqual({ status: "revoked" })
  })

  it("maps ERROR to error with fallback message", () => {
    expect(connectionUiState(conn({ status: "ERROR", lastError: null }))).toEqual({
      status: "error",
      errorMessage: "Connection failed",
    })
    expect(connectionUiState(conn({ status: "ERROR", lastError: "boom" }))).toEqual({
      status: "error",
      errorMessage: "boom",
    })
  })

  it("treats API_KEY PENDING with lastError as connected-with-warning, not disconnected", () => {
    const result = connectionUiState(
      conn({
        status: "PENDING",
        connectionType: "API_KEY",
        lastError: "Saved but could not verify",
      }),
    )
    expect(result).toEqual({
      status: "connected",
      warningMessage: "Saved but could not verify",
    })
  })

  it("treats OAuth PENDING as disconnected regardless of lastError", () => {
    // PR #4 Commit 6 note: OAuth PENDING means "Composio hasn't completed
    // the handshake yet" — do not leak it as connected.
    const result = connectionUiState(
      conn({
        status: "PENDING",
        connectionType: "OAUTH_COMPOSIO",
        lastError: "whatever",
      }),
    )
    expect(result).toEqual({ status: "disconnected" })
  })

  it("maps NEEDS_CREDENTIALS to the amber badge variant", () => {
    const result = connectionUiState(
      conn({ status: "NEEDS_CREDENTIALS", lastError: "Missing: BINANCE_API_SECRET" }),
    )
    expect(result.status).toBe("needs-credentials")
    expect(result.warningMessage).toBe("Missing: BINANCE_API_SECRET")
  })

  it("defaults unknown status strings to disconnected", () => {
    expect(connectionUiState(conn({ status: "SOMETHING_WEIRD" }))).toEqual({ status: "disconnected" })
  })
})

describe("buildExtraToolState", () => {
  it("marks the row extra=true and required=false", () => {
    const state = buildExtraToolState(conn())
    expect(state.extra).toBe(true)
    expect(state.required).toBe(false)
  })

  it("resolves catalog metadata for known slugs", () => {
    const state = buildExtraToolState(conn({ toolSlug: "gmail" }))
    expect(state.name).toBe("Gmail")
    expect(state.category).toBe("EMAIL")
    expect(state.connectionType).toBe("OAUTH_COMPOSIO")
  })

  it("falls back to the connection's displayName when the slug isn't in the static catalog", () => {
    // Dynamic Composio toolkit case: Composio's browse catalog surfaces
    // slugs that aren't in our tool-catalog.ts. The user can still have
    // connected them; we render whatever metadata we have.
    const state = buildExtraToolState(
      conn({
        toolSlug: "some_dynamic_toolkit",
        displayName: "My Dynamic Toolkit",
        connectionType: "OAUTH_COMPOSIO",
      }),
    )
    expect(state.slug).toBe("some_dynamic_toolkit")
    expect(state.name).toBe("My Dynamic Toolkit")
    expect(state.category).toBe("OTHER")
  })

  it("propagates createdAt for OAuth 'Connected N days ago' rendering", () => {
    const state = buildExtraToolState(conn({ createdAt: "2026-04-20T22:15:48.620Z" }))
    expect(state.connectedAt).toBe("2026-04-20T22:15:48.620Z")
  })

  it("carries the UI status derived from connectionUiState", () => {
    expect(buildExtraToolState(conn({ status: "CONNECTED" })).status).toBe("connected")
    expect(buildExtraToolState(conn({ status: "EXPIRED" })).status).toBe("expired")
  })
})

describe("buildExtraToolsFromConnections", () => {
  const tavilyTemplateRow: Pick<ToolState, "slug"> = { slug: "tavily" }
  const twitterTemplateRow: Pick<ToolState, "slug"> = { slug: "twitter_api" }

  it("returns [] when every connection's slug is already represented", () => {
    const result = buildExtraToolsFromConnections(
      [tavilyTemplateRow, twitterTemplateRow],
      [conn({ toolSlug: "tavily", connectionType: "API_KEY" })],
    )
    expect(result).toEqual([])
  })

  it("returns one ToolState for a non-template connection (the bug case)", () => {
    const result = buildExtraToolsFromConnections(
      [tavilyTemplateRow, twitterTemplateRow],
      [conn({ toolSlug: "gmail", connectionType: "OAUTH_COMPOSIO", status: "CONNECTED" })],
    )
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe("gmail")
    expect(result[0].status).toBe("connected")
    expect(result[0].extra).toBe(true)
  })

  it("appends multiple non-template connections while skipping overlaps", () => {
    const result = buildExtraToolsFromConnections(
      [tavilyTemplateRow],
      [
        conn({ toolSlug: "tavily", connectionType: "API_KEY" }), // template overlap — skip
        conn({ toolSlug: "gmail", connectionType: "OAUTH_COMPOSIO" }),
        conn({ toolSlug: "slack", connectionType: "OAUTH_COMPOSIO", id: "c2", displayName: "Slack" }),
      ],
    )
    expect(result.map((r) => r.slug)).toEqual(["gmail", "slack"])
  })

  it("de-dupes connections that share a toolSlug (defensive)", () => {
    const result = buildExtraToolsFromConnections(
      [],
      [
        conn({ toolSlug: "gmail", id: "c1" }),
        conn({ toolSlug: "gmail", id: "c2" }), // dup defensively dropped
      ],
    )
    expect(result).toHaveLength(1)
    expect(result[0].connectionId).toBe("c1")
  })

  it("excludes AI providers from the 'Additional tools' section", () => {
    // AI providers (anthropic_api, openai_api, etc.) live on Step 1 and
    // are explicitly filtered out of Step 2. An AI-provider connection
    // leaking into the "Additional tools" section would be confusing UX
    // — the user would see "Anthropic (Claude)" as a tool they can
    // disconnect via Step 2, when it's managed on Step 1.
    const result = buildExtraToolsFromConnections(
      [],
      [
        conn({ toolSlug: "anthropic_api", connectionType: "API_KEY", displayName: "Anthropic" }),
        conn({ toolSlug: "gmail", connectionType: "OAUTH_COMPOSIO" }),
      ],
    )
    expect(result.map((r) => r.slug)).toEqual(["gmail"])
  })

  it("preserves input order of non-template connections", () => {
    const result = buildExtraToolsFromConnections(
      [],
      [
        conn({ toolSlug: "gmail", connectionType: "OAUTH_COMPOSIO", id: "c1" }),
        conn({ toolSlug: "slack", connectionType: "OAUTH_COMPOSIO", id: "c2", displayName: "Slack" }),
        conn({ toolSlug: "github", connectionType: "OAUTH_COMPOSIO", id: "c3", displayName: "GitHub" }),
      ],
    )
    expect(result.map((r) => r.slug)).toEqual(["gmail", "slack", "github"])
  })
})

describe("integration — non-template OAuth tool flows into connectedSlugs", () => {
  // This is the UX-level contract the commit is about:
  //   "after a user connects Gmail via Browse Tools on a workspace whose
  //    template doesn't list Gmail, connectedSlugs includes 'gmail'."
  //
  // In the page component this is:
  //     setTools([...templateTools, ...buildExtraToolsFromConnections(templateTools, existing)])
  //     const connectedSlugs = tools.filter(t => t.status === "connected").map(t => t.slug)
  //
  // Test just that pipeline directly — no page rendering needed.
  it("a non-template CONNECTED gmail row surfaces in both tools AND connectedSlugs", () => {
    const templateTools: ToolState[] = [
      {
        slug: "tavily",
        name: "Tavily",
        connectionType: "API_KEY",
        category: "SEARCH",
        status: "disconnected",
        required: false,
      },
    ]
    const connections = [conn({ toolSlug: "gmail", status: "CONNECTED" })]

    const extras = buildExtraToolsFromConnections(templateTools, connections)
    const tools = [...templateTools, ...extras]
    const connectedSlugs = tools.filter((t) => t.status === "connected").map((t) => t.slug)

    expect(connectedSlugs).toContain("gmail")
    expect(tools.find((t) => t.slug === "gmail")?.extra).toBe(true)
  })
})
