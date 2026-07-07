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
  it("renders sessions with provider tags only for known providers", async () => {
    mockFetch()

    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    expect(await screen.findByText("agent:dev-commander:main")).toBeTruthy()
    expect(screen.getByText("via Telegram")).toBeTruthy()
    expect(screen.getByText("agent:sender-ish:main")).toBeTruthy()
    expect(screen.getByText("3 messages")).toBeTruthy()
    expect(screen.getAllByText(/^via /)).toHaveLength(1)
  })

  it("opens a read-only transcript modal with chat-bubble rendering", async () => {
    mockFetch()

    render(<ConversationsSection workspaceId="ws-1" status="RUNNING" />)

    fireEvent.click(await screen.findByRole("button", { name: /agent:dev-commander:main/i }))

    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Read-only — reply from the channel itself.")).toBeTruthy()
    await waitFor(() => expect(screen.getByText("hello from telegram")).toBeTruthy())
    expect(screen.getByText("· used web_search")).toBeTruthy()
    expect(screen.getByText("hello back")).toBeTruthy()
  })

  it("shows a quiet empty state for stopped workspaces without fetching", () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock

    render(<ConversationsSection workspaceId="ws-1" status="STOPPED" />)

    expect(screen.getByText("Conversations are readable while the Claw is running.")).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
