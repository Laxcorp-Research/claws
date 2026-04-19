// @vitest-environment jsdom
//
// PR #4 Commit 6 — rendering-surface contract for OAUTH_COMPOSIO ToolRow
// states. Click handlers are stubbed; we assert only that the rendering
// differs correctly. Click-to-mutation wiring lands in PR #4 Commit 7.
//
// What these tests lock in:
//   1. OAuth CONNECTED rows show relative "Connected N days ago" (not
//      the static category description) when connectedAt is supplied.
//   2. OAuth CONNECTED rows surface a Revoke button (outline danger) when
//      onRevoke is supplied — NOT the legacy generic "Disconnect" text
//      button. API_KEY rows continue to show "Disconnect".
//   3. OAuth EXPIRED/REVOKED rows render "Token expired — reconnect
//      required" description, a red StatusDot, and a Reconnect button
//      replacing Revoke.
//   4. Non-OAuth (API_KEY) rows are unaffected by the OAuth-specific
//      rendering — category description + Test + Disconnect as before.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react"
import { ToolRow } from "@/components/setup/tool-row"

afterEach(() => {
  cleanup()
})

function fixedDate(daysAgo: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d
}

describe("ToolRow — OAUTH_COMPOSIO CONNECTED rendering (PR #4 Commit 6)", () => {
  it("renders 'Connected N days ago' instead of the static description when connectedAt is supplied", () => {
    render(
      <ToolRow
        name="Gmail"
        description="EMAIL"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        connectedAt={fixedDate(7)}
      />,
    )
    expect(screen.getByText("Connected 7 days ago")).toBeDefined()
    // Category description should be replaced, not stacked:
    expect(screen.queryByText("EMAIL")).toBeNull()
  })

  it("falls back to the static description when connectedAt is missing", () => {
    render(
      <ToolRow
        name="Gmail"
        description="EMAIL"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
      />,
    )
    // No connectedAt → description remains visible
    expect(screen.getByText("EMAIL")).toBeDefined()
    expect(screen.queryByText(/Connected \d+ days? ago/)).toBeNull()
  })

  it("renders 'Connected today' for a same-day connection", () => {
    render(
      <ToolRow
        name="GitHub"
        description="DEVELOPMENT"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        connectedAt={fixedDate(0)}
      />,
    )
    expect(screen.getByText("Connected today")).toBeDefined()
  })

  it("pluralizes '1 day ago' correctly", () => {
    render(
      <ToolRow
        name="Slack"
        description="MESSAGING"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        connectedAt={fixedDate(1)}
      />,
    )
    expect(screen.getByText("Connected 1 day ago")).toBeDefined()
  })

  it("renders a Revoke button (outline danger) when onRevoke is supplied, replacing Disconnect", () => {
    const onRevoke = vi.fn()
    const onDisconnect = vi.fn()
    render(
      <ToolRow
        name="HubSpot"
        description="CRM"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        onRevoke={onRevoke}
        onDisconnect={onDisconnect}
      />,
    )
    expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull()
  })

  it("Revoke button invokes onRevoke (and NOT onDisconnect) when clicked", () => {
    const onRevoke = vi.fn()
    const onDisconnect = vi.fn()
    render(
      <ToolRow
        name="HubSpot"
        description="CRM"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        onRevoke={onRevoke}
        onDisconnect={onDisconnect}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    expect(onRevoke).toHaveBeenCalledTimes(1)
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it("falls back to Disconnect when onRevoke is not supplied (e.g., first-wire state)", () => {
    const onDisconnect = vi.fn()
    render(
      <ToolRow
        name="Notion"
        description="CONTENT"
        connectionStatus="connected"
        connectionType="OAUTH_COMPOSIO"
        onDisconnect={onDisconnect}
      />,
    )
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined()
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull()
  })
})

describe("ToolRow — OAUTH_COMPOSIO EXPIRED / REVOKED rendering (PR #4 Commit 6)", () => {
  it("EXPIRED: renders red dot, 'Token expired — reconnect required', and Reconnect button", () => {
    const onReconnect = vi.fn()
    const { container } = render(
      <ToolRow
        name="HubSpot"
        description="CRM"
        connectionStatus="expired"
        connectionType="OAUTH_COMPOSIO"
        onReconnect={onReconnect}
      />,
    )
    expect(screen.getByText("Token expired — reconnect required")).toBeDefined()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined()
    // StatusDot with aria-label for expired state (see status-dot.tsx)
    const dot = within(container).getByRole("img", {
      name: /HubSpot OAuth connection expired/,
    })
    expect(dot).toBeDefined()
  })

  it("REVOKED: renders same UI as EXPIRED (both are 'reconnect required' states)", () => {
    const onReconnect = vi.fn()
    render(
      <ToolRow
        name="Slack"
        description="MESSAGING"
        connectionStatus="revoked"
        connectionType="OAUTH_COMPOSIO"
        onReconnect={onReconnect}
      />,
    )
    expect(screen.getByText("Token expired — reconnect required")).toBeDefined()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined()
  })

  it("Reconnect button invokes onReconnect when clicked", () => {
    const onReconnect = vi.fn()
    render(
      <ToolRow
        name="Gmail"
        description="EMAIL"
        connectionStatus="expired"
        connectionType="OAUTH_COMPOSIO"
        onReconnect={onReconnect}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it("does NOT render a Revoke button on EXPIRED/REVOKED (user must Reconnect first)", () => {
    const onRevoke = vi.fn()
    const onReconnect = vi.fn()
    render(
      <ToolRow
        name="GitHub"
        description="DEVELOPMENT"
        connectionStatus="expired"
        connectionType="OAUTH_COMPOSIO"
        onRevoke={onRevoke}
        onReconnect={onReconnect}
      />,
    )
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDefined()
  })
})

describe("ToolRow — API_KEY rows unaffected by OAuth-specific rendering (PR #4 Commit 6 regression guard)", () => {
  it("API_KEY CONNECTED: keeps the static category description even when connectedAt is supplied", () => {
    render(
      <ToolRow
        name="Tavily"
        description="SEARCH"
        connectionStatus="connected"
        connectionType="API_KEY"
        connectedAt={fixedDate(30)}
      />,
    )
    // connectedAt is silently ignored for non-OAuth rows
    expect(screen.getByText("SEARCH")).toBeDefined()
    expect(screen.queryByText(/Connected \d+ days? ago/)).toBeNull()
  })

  it("API_KEY CONNECTED: Revoke prop ignored (OAuth-only), Disconnect still rendered", () => {
    const onRevoke = vi.fn()
    const onDisconnect = vi.fn()
    render(
      <ToolRow
        name="Tavily"
        description="SEARCH"
        connectionStatus="connected"
        connectionType="API_KEY"
        onRevoke={onRevoke}
        onDisconnect={onDisconnect}
      />,
    )
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull()
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDefined()
  })

  it("API_KEY 'error' status renders the primary Retry button (the new OAuth-specific primary Reconnect is NOT used)", () => {
    const onReconnect = vi.fn()
    render(
      <ToolRow
        name="Binance"
        description="TRADING"
        connectionStatus="error"
        connectionType="API_KEY"
        errorMessage="Invalid signature"
        onReconnect={onReconnect}
      />,
    )
    // Primary right-side action is Retry (outline danger), same as pre-PR #4.
    // Note: API_KEY error also renders an inline underlined "Reconnect" link
    // inside the error message paragraph — that's pre-existing behavior,
    // separate from the new OAuth EXPIRED/REVOKED primary Reconnect button,
    // and we're not guarding against it here. The regression we DO care
    // about is: API_KEY error must not start using the new primary
    // button (`rounded-md bg-[var(--tx)] text-white`) — only OAuth
    // EXPIRED/REVOKED does.
    const retry = screen.getByRole("button", { name: "Retry" })
    expect(retry).toBeDefined()
    // The new OAuth Reconnect primary button would have background var(--tx)
    // + white text. The inline error-link has `font-semibold underline`
    // classes — distinct enough to detect the regression.
    const reconnectButtons = screen.getAllByRole("button", { name: "Reconnect" })
    for (const btn of reconnectButtons) {
      expect(btn.className).toContain("underline") // pre-existing inline link
      expect(btn.className).not.toContain("bg-[var(--tx)]") // not the OAuth primary
    }
  })
})
