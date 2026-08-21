// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ConversationsSection } from "@/components/dashboard/conversations-section"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/api/workspaces/ws-1/conversations")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            available: true,
            mode: "live",
            conversations: [
              {
                sessionKey: "agent:dev-commander:main",
                channelHint: "telegram",
                lastActivityAt: "2026-07-06T10:00:00.000Z",
                messageCount: 3,
              },
              {
                sessionKey: "agent:sender-ish:main",
                channelHint: "unknown",
                lastActivityAt: null,
              },
            ],
            archived: [
              {
                sessionKey: "orphaned:6f484ca3-1111-2222-3333-444444444444",
                channelHint: "unknown",
                lastActivityAt: "2026-07-08T06:31:00.000Z",
                messageCount: 2,
                reason: "rotated-main",
              },
            ],
          },
        }),
      } as Response
    }
    if (url.endsWith(`/api/workspaces/ws-1/conversations/${encodeURIComponent("agent:dev-commander:main")}`)) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            available: true,
            sessionKey: "agent:dev-commander:main",
            messages: [
              { type: "message", role: "user", content: "hello from telegram", at: "2026-07-06T10:00:00.000Z" },
              { type: "tool", name: "web_search", at: "2026-07-06T10:00:01.000Z" },
              { type: "message", role: "assistant", content: "hello back", at: "2026-07-06T10:00:02.000Z" },
            ],
          },
        }),
      } as Response
    }
    return { ok: false, json: async () => ({ success: false }) } as Response
  })
  global.fetch = fetchMock
  return fetchMock
}

describe("ConversationsSection", () => {
  it("renders conversation session keys through truncation-ready text", async () => {
    mockFetch()

    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    const key = await screen.findByText("agent:dev-commander:main")
    expect(key.className).toContain("text-ellipsis")
  })

  it("renders sessions with provider tags only for known providers", async () => {
    mockFetch()

    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    expect(await screen.findByText("agent:dev-commander:main")).toBeTruthy()
    expect(screen.getByText("via Telegram")).toBeTruthy()
    expect(screen.getByText("agent:sender-ish:main")).toBeTruthy()
    expect(screen.getByText("3 messages")).toBeTruthy()
    expect(screen.getAllByText(/^via /)).toHaveLength(1)
  })

  it("opens a read-only two-pane transcript with chat-bubble rendering", async () => {
    mockFetch()

    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    fireEvent.click(await screen.findByRole("button", { name: /agent:dev-commander:main/i }))

    expect(screen.getByText("Read-only - reply from the channel itself.")).toBeTruthy()
    await waitFor(() => expect(screen.getByText("hello from telegram")).toBeTruthy())
    expect(screen.getByText("· used web_search")).toBeTruthy()
    expect(screen.getByText("hello back")).toBeTruthy()
  })

  it("live mode renders archived section with rotated-main row", async () => {
    mockFetch()
    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    expect(await screen.findByTestId("conversations-archived")).toBeTruthy()
    expect(screen.getByText("Archived sessions")).toBeTruthy()
    expect(screen.getByText(/orphaned:6f484ca3/)).toBeTruthy()
    expect(screen.getByText(/rotated main/)).toBeTruthy()
  })

  it("HIBERNATED snapshot mode shows Read-only · as of banner", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          available: true,
          mode: "snapshot",
          asOf: "2026-07-11T12:41:00.000Z",
          conversations: [
            {
              sessionKey: "agent:dev-commander:main",
              channelHint: "telegram",
              lastActivityAt: "2026-07-11T12:42:00.000Z",
              messageCount: 1,
            },
          ],
          archived: [],
        },
      }),
    })) as unknown as typeof fetch

    render(<ConversationsSection workspaceId="ws-1" status="HIBERNATED" />)

    const banner = await screen.findByTestId("conversations-readonly-banner")
    expect(banner.textContent).toBe("Read-only · as of 2026-07-11T12:41:00Z")
    expect(screen.getByText("agent:dev-commander:main")).toBeTruthy()
  })

  it("WAKING banner variant mentions Waking + asOf when saved history present", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          available: true,
          mode: "snapshot",
          asOf: "2026-07-11T12:41:00.000Z",
          conversations: [],
          archived: [],
        },
      }),
    })) as unknown as typeof fetch

    render(<ConversationsSection workspaceId="ws-1" status="WAKING" />)

    // Wait for fetch→asOf; banner mounts immediately with placeholder copy.
    const banner = await screen.findByText(
      "Waking · showing saved history as of 2026-07-11T12:41:00Z",
    )
    expect(banner).toBeTruthy()
  })

  it("STOPPED with no saved history shows empty copy", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: { available: false, reason: "not_running", conversations: [], archived: [] },
      }),
    })) as unknown as typeof fetch

    render(<ConversationsSection workspaceId="ws-1" status="STOPPED" />)

    expect(
      await screen.findByText("No saved conversation history yet. Wake or run the Claw once to capture history."),
    ).toBeTruthy()
  })

  it("corrupt gzip shows error banner + empty copy", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          available: false,
          reason: "corrupt",
          asOf: "2026-07-11T12:41:00.000Z",
          conversations: [],
          archived: [],
        },
      }),
    })) as unknown as typeof fetch

    render(<ConversationsSection workspaceId="ws-1" status="HIBERNATED" />)

    expect(await screen.findByTestId("conversations-corrupt-banner")).toBeTruthy()
    expect(
      screen.getByText(/Saved conversation history is unreadable/),
    ).toBeTruthy()
  })

  it("saved history with zero sessions shows no-sessions empty copy", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          available: true,
          mode: "snapshot",
          asOf: "2026-07-11T12:41:00.000Z",
          conversations: [],
          archived: [],
        },
      }),
    })) as unknown as typeof fetch

    render(<ConversationsSection workspaceId="ws-1" status="HIBERNATED" />)

    expect(await screen.findByText("No readable conversations in saved history.")).toBeTruthy()
  })
})
