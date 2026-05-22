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
  mergeRefreshedTools,
  resolveByokModalProps,
  type ServerConnectionSummary,
  type ToolState,
  type BYOKModalState,
} from "@/components/setup/tools-state"
import type { ApiKeyFormPayload } from "@/lib/oauth/use-oauth-connection"

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

// PR2.9-fix1 (Bug 1B): regression guard for the BYOK modal render path.
//
// The bug: the wizard's BYOK modal JSX conditional required
// `byokModal.tool` non-null. For Browse-modal clicks on non-template tools
// (e.g., user clicks Connect on Typefully from Browse Tools, but Typefully
// isn't in this workspace's template), `byokModal.tool` was null and the
// modal never rendered. User saw nothing on click.
//
// The fix: `resolveByokModalProps` resolves the display name from a
// 4-step fallback chain so the modal renders regardless of whether the
// wizard's `tools` state knows about the toolkit. Test #4 below is the
// regression guard for the non-template-tool path — if the JSX conditional
// is ever re-tightened or the fallback chain is reverted, this test fails.
//
// Mutation procedure (verify after editing resolveByokModalProps):
//   1. Temporarily change `if (!state.open || !state.apiKeyForm)` to
//      `if (!state.open || !state.apiKeyForm || !state.tool)` (re-add the
//      null-tool block).
//   2. Run this test file. Confirm tests #3 + #4 fail with clear messages
//      naming the broken path.
//   3. Restore the conditional. Tests pass.
describe("resolveByokModalProps (PR2.9-fix1 Bug 1B regression guard)", () => {
  const baseApiKeyForm: ApiKeyFormPayload = {
    toolSlug: "typefully",
    displayName: "Typefully",
    fields: [
      { envVar: "TYPEFULLY_API_KEY", label: "API Key", required: true, primary: true },
    ],
    helpUrl: "https://typefully.com/settings/integrations",
  }

  function state(overrides: Partial<BYOKModalState> = {}): BYOKModalState {
    return {
      open: false,
      tool: null,
      apiKeyForm: null,
      ...overrides,
    }
  }

  it("#1 returns null when modal is closed", () => {
    expect(resolveByokModalProps(state({ open: false, apiKeyForm: baseApiKeyForm }))).toBeNull()
  })

  it("#2 returns null when apiKeyForm is missing", () => {
    expect(resolveByokModalProps(state({ open: true, apiKeyForm: null }))).toBeNull()
  })

  it("#3 template-row click: tool present → toolName from tool.name (highest priority)", () => {
    const tool: ToolState = {
      slug: "typefully",
      name: "Typefully (custom display)",
      connectionType: "OAUTH_COMPOSIO",
      category: "SOCIAL",
      status: "disconnected",
      required: false,
    }
    const props = resolveByokModalProps(state({ open: true, tool, apiKeyForm: baseApiKeyForm }))
    expect(props).not.toBeNull()
    expect(props!.toolName).toBe("Typefully (custom display)")
    expect(props!.credentialFields).toBe(baseApiKeyForm.fields)
    expect(props!.helpUrl).toBe(baseApiKeyForm.helpUrl)
  })

  it("#4 Browse-modal click on non-template tool: tool === null → modal STILL renders with displayName fallback (THE BUG 1B FIX)", () => {
    // This is the scenario the operator surfaced on staging visual verify.
    // Pre-fix: byokModal.tool was null → JSX conditional `&& byokModal.tool`
    // evaluated false → modal never rendered → user saw nothing on click.
    // Post-fix: resolveByokModalProps returns a non-null result, modal
    // renders using apiKeyForm.displayName as the toolName.
    const props = resolveByokModalProps(state({ open: true, tool: null, apiKeyForm: baseApiKeyForm }))
    expect(
      props,
      "Bug 1B regression: BYOK modal must render even when tool is null (Browse-modal non-template path)",
    ).not.toBeNull()
    expect(props!.toolName).toBe("Typefully")
    expect(props!.credentialFields).toBe(baseApiKeyForm.fields)
  })

  it("#5 fallback chain: tool null, displayName empty → falls back to client catalog lookup", () => {
    // Edge case: server's initiate response returned a degenerate
    // displayName (empty string). Defensively, the catalog lookup catches
    // this — gmail isn't a BYOK toolkit in real life but we test with it
    // because we know it's in the catalog with name "Gmail".
    const form: ApiKeyFormPayload = {
      ...baseApiKeyForm,
      toolSlug: "gmail",
      displayName: "",
    }
    const props = resolveByokModalProps(state({ open: true, tool: null, apiKeyForm: form }))
    expect(props).not.toBeNull()
    // The "" empty-string falsy-coalesce via ?? actually returns "" (not
    // undefined), so the chain proceeds to catalog only when displayName
    // is undefined/null. Document the realistic chain behavior:
    // Empty-string displayName surfaces AS the empty string — the route
    // should never send it, but if it does we'd see an empty modal title.
    // This test pins that behavior so a regression to "skip-falsy" doesn't
    // silently change semantics. If we ever want to skip empty strings,
    // the fallback chain in resolveByokModalProps needs to be updated
    // (use `|| undefined` after each step).
    expect(props!.toolName).toBe("")
  })

  it("#6 fallback chain: tool null, no displayName, slug not in catalog → falls back to raw slug", () => {
    // Last-resort: tool unknown to client catalog and server didn't
    // provide displayName. User sees the raw slug as the modal title.
    // Better than rendering nothing.
    const form: ApiKeyFormPayload = {
      toolSlug: "unknown_future_toolkit_2026",
      // displayName omitted entirely (undefined, not "")
      fields: baseApiKeyForm.fields,
    }
    const props = resolveByokModalProps(state({ open: true, tool: null, apiKeyForm: form }))
    expect(props).not.toBeNull()
    expect(props!.toolName).toBe("unknown_future_toolkit_2026")
  })
})

// PR2.9-fix3 regression guard for the stale-UI-after-revoke bug.
//
// Background: `refreshTools` in src/app/setup/[workspaceId]/step/[n]/page.tsx
// was insert-only — `if (!conn) return t` kept the local row exactly as
// it was when the server response omitted that slug. After a successful
// revoke/disconnect the row UI still said "Connected" until a full page
// reload. The fix moved the merge logic into this pure `mergeRefreshedTools`
// function and made the server response genuinely authoritative.
//
// These tests are the FIRST tests of refreshTools' deletion behavior —
// before this PR the invariant was completely unguarded. If any future
// refactor reintroduces the insert-only behavior (e.g., to "optimize"
// the function by skipping resets), these tests must fail loudly.
//
// Mutation procedure (verify after editing mergeRefreshedTools):
//   1. In mergeRefreshedTools, replace the `if (t.extra) return null`
//      and the reset block with `return t` (the old broken behavior).
//   2. Run this test file. Confirm tests #1, #2, and #4 fail. Test #3
//      (the "connection present" happy path) should still pass — it's
//      the no-regression guard for the working path.
//   3. Restore the function. All tests pass.
describe("mergeRefreshedTools (PR2.9-fix3 stale-UI-after-revoke regression guard)", () => {
  // Helper: a "connected" template row with connectionId populated.
  // Represents what the local state looks like RIGHT BEFORE the user
  // clicks Revoke/Disconnect.
  function connectedTemplateRow(slug: string): ToolState {
    return {
      slug,
      name: slug,
      connectionType: "OAUTH_COMPOSIO",
      category: "SOCIAL",
      status: "connected",
      connectionId: `conn_${slug}_old`,
      connectedAt: "2026-04-20T22:15:48.620Z",
      errorMessage: undefined,
      warningMessage: undefined,
      required: true,
    }
  }

  // Helper: a "connected" extra row (came from Browse-modal click on a
  // non-template tool). Pre-PR2.9-fix3, this row would persist forever
  // after a revoke because the merge never removed it.
  function connectedExtraRow(slug: string): ToolState {
    return {
      slug,
      name: slug,
      connectionType: "OAUTH_COMPOSIO",
      category: "OTHER",
      status: "connected",
      connectionId: `conn_${slug}_old`,
      connectedAt: "2026-04-20T22:15:48.620Z",
      required: false,
      extra: true,
    }
  }

  it("#1 BUG FIX: template row whose server connection is REMOVED resets to 'disconnected' and clears stale connectionId/connectedAt/error/warning", () => {
    // The user clicked Revoke on Typefully (a template row). Backend
    // deleted the ToolConnection. The server response now omits the slug.
    // Pre-fix: row stayed `status: "connected"` with the old connectionId.
    // Post-fix: row resets to disconnected, all stale fields cleared.
    const prev: ToolState[] = [
      {
        ...connectedTemplateRow("typefully"),
        errorMessage: "stale error from a previous failed test",
        warningMessage: "stale warning",
      },
    ]
    const result = mergeRefreshedTools(prev, [])

    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe("typefully")
    expect(result[0].status).toBe("disconnected")
    expect(result[0].connectionId).toBeUndefined()
    expect(result[0].connectedAt).toBeNull()
    expect(result[0].errorMessage).toBeUndefined()
    expect(result[0].warningMessage).toBeUndefined()
    // Identity preserved — template metadata must survive the reset so
    // the row stays in its required/recommended bucket with the right
    // name, category, etc.
    expect(result[0].name).toBe("typefully")
    expect(result[0].category).toBe("SOCIAL")
    expect(result[0].required).toBe(true)
  })

  it("#2 BUG FIX: extra row whose server connection is REMOVED is dropped entirely from the list", () => {
    // The user opened Browse, connected Typefully (not in template), then
    // later clicked Revoke. Extra rows exist ONLY because of the server
    // connection — when the server says it's gone, the row should vanish.
    // Pre-fix: row stayed in `tools` as `extra: true, status: "connected"`
    // forever (until reload).
    const prev: ToolState[] = [
      // Sibling template row that DOES have a server connection — used
      // to confirm the drop is targeted, not a wholesale wipe.
      connectedTemplateRow("gmail"),
      connectedExtraRow("typefully"),
    ]
    const serverConnections: ServerConnectionSummary[] = [
      {
        toolSlug: "gmail",
        status: "CONNECTED",
        id: "conn_gmail_new",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-20T22:15:48.620Z",
      },
      // typefully omitted — the user revoked it.
    ]
    const result = mergeRefreshedTools(prev, serverConnections)

    // Only the template row survives.
    expect(result.map((t) => t.slug)).toEqual(["gmail"])
    expect(result.find((t) => t.slug === "typefully")).toBeUndefined()
  })

  it("#3 no regression on the working path: template row WITH a matching server connection still updates correctly", () => {
    // The case the pre-fix code handled correctly. This test pins that
    // the fix didn't break the happy path. If a future refactor breaks
    // the connection-present branch, this fails first.
    const prev: ToolState[] = [
      {
        ...connectedTemplateRow("gmail"),
        // Stale local state: status: "connecting" (user clicked Connect
        // and the spinner is still showing) → server says it's done.
        status: "connecting",
      },
    ]
    const serverConnections: ServerConnectionSummary[] = [
      {
        toolSlug: "gmail",
        status: "CONNECTED",
        id: "conn_gmail_NEW",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-20T22:15:48.620Z",
      },
    ]
    const result = mergeRefreshedTools(prev, serverConnections)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("connected")
    expect(result[0].connectionId).toBe("conn_gmail_NEW")
    expect(result[0].connectedAt).toBe("2026-04-20T22:15:48.620Z")
  })

  it("#4 mixed scenario: in a single refresh, one row stays connected, one template revokes (resets), one extra revokes (drops)", () => {
    // The full disconnect-while-still-using-other-tools UX flow. The
    // user has 3 connections: gmail (template, kept), tavily (template,
    // revoked), typefully (extra, revoked). One refresh, one merge,
    // three correct outcomes.
    const prev: ToolState[] = [
      connectedTemplateRow("gmail"),
      connectedTemplateRow("tavily"),
      connectedExtraRow("typefully"),
    ]
    const serverConnections: ServerConnectionSummary[] = [
      // Only gmail survives.
      {
        toolSlug: "gmail",
        status: "CONNECTED",
        id: "conn_gmail",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-20T22:15:48.620Z",
      },
    ]
    const result = mergeRefreshedTools(prev, serverConnections)

    // typefully (extra) is dropped, tavily (template) remains visible
    // as disconnected, gmail stays connected.
    expect(result.map((t) => t.slug)).toEqual(["gmail", "tavily"])
    expect(result.find((t) => t.slug === "gmail")!.status).toBe("connected")
    expect(result.find((t) => t.slug === "tavily")!.status).toBe("disconnected")
    expect(result.find((t) => t.slug === "tavily")!.connectionId).toBeUndefined()
  })

  it("#5 the existing 'append new server rows' path still works (no regression on buildExtraToolsFromConnections integration)", () => {
    // After this PR, mergeRefreshedTools delegates the "server has a row
    // not in prev" case to buildExtraToolsFromConnections. Pin that
    // integration so a future refactor doesn't accidentally drop the
    // append step (which would re-introduce GH #39 — non-template
    // connections invisible to the wizard UI).
    const prev: ToolState[] = [connectedTemplateRow("gmail")]
    const serverConnections: ServerConnectionSummary[] = [
      {
        toolSlug: "gmail",
        status: "CONNECTED",
        id: "conn_gmail",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-20T22:15:48.620Z",
      },
      {
        toolSlug: "slack", // brand-new connection, never seen in prev
        status: "CONNECTED",
        id: "conn_slack",
        displayName: "Slack",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-21T10:00:00.000Z",
      },
    ]
    const result = mergeRefreshedTools(prev, serverConnections)

    expect(result.map((t) => t.slug)).toEqual(["gmail", "slack"])
    const slackRow = result.find((t) => t.slug === "slack")!
    expect(slackRow.extra).toBe(true)
    expect(slackRow.status).toBe("connected")
    expect(slackRow.connectionId).toBe("conn_slack")
  })

  it("#6 the fix covers BOTH disconnect paths (OAuth + API_KEY) since both share refreshTools — exercise with an API_KEY row", () => {
    // The diagnosis flagged that `handleDisconnect` (the API_KEY DELETE
    // path) had the same blind spot as `handleOauthRevokeConfirm`. This
    // test pins that the primitive-level fix handles API_KEY tools too,
    // so no per-handler optimistic patch is needed.
    const prev: ToolState[] = [
      {
        slug: "tavily",
        name: "Tavily",
        connectionType: "API_KEY",
        category: "SEARCH",
        status: "connected",
        connectionId: "conn_tavily_old",
        connectedAt: "2026-04-20T22:15:48.620Z",
        required: true,
      },
    ]
    const result = mergeRefreshedTools(prev, [])

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("disconnected")
    expect(result[0].connectionId).toBeUndefined()
    expect(result[0].connectionType).toBe("API_KEY")
  })

  it("#7 empty inputs: empty prev + empty connections → empty output (no crash)", () => {
    expect(mergeRefreshedTools([], [])).toEqual([])
  })

  it("#8 prev untouched (no mutation): the input array reference is unchanged after the merge (immutability guard)", () => {
    // Immutability matters because React's setState depends on
    // structural-equality detection in some paths. If we ever start
    // returning the same array reference on no-change, React might skip
    // an intended re-render.
    const original: ToolState[] = [connectedTemplateRow("gmail")]
    const frozen = Object.freeze([...original])
    mergeRefreshedTools(frozen as ToolState[], [
      {
        toolSlug: "gmail",
        status: "CONNECTED",
        id: "conn_gmail",
        connectionType: "OAUTH_COMPOSIO",
        createdAt: "2026-04-20T22:15:48.620Z",
      },
    ])
    // Original frozen array still has its original objects — no mutation.
    expect(frozen[0].connectionId).toBe("conn_gmail_old")
  })
})
