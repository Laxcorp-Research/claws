// @vitest-environment jsdom
//
// PR-9/B ChatPanel: (1) the optimistic-dedupe invariant (reconcileChatMessages)
// and (2) composer behavior (disabled when not sendable; failed bubble on a
// non-202 send, never a throw).

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import {
  ChatPanel,
  reconcileChatMessages,
  type ChatRow,
  type OptimisticMessage,
} from "@/components/dashboard/chat-panel"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("reconcileChatMessages — optimistic dedupe by messageId === runId", () => {
  it("drops the optimistic user bubble once the streamed MESSAGE_RECEIVED with the same messageId arrives (no double-render)", () => {
    const optimistic: OptimisticMessage[] = [
      { tempId: "tmp_1", text: "hello orchestrator", createdAt: 1000, status: "sent", runId: "run-X" },
    ]
    const rows: ChatRow[] = [
      {
        id: "log-1",
        actionType: "MESSAGE_RECEIVED",
        timestamp: "2026-06-22T08:00:00.000Z",
        agentName: "System",
        action: "Received from : hello orchestrator",
        detail: "hello orchestrator",
        messageId: "run-X",
      },
    ]
    const views = reconcileChatMessages(optimistic, rows, "Dev Commander")
    const userViews = views.filter((v) => v.sender === "user")
    // Exactly ONE — not 2. MUTATION: remove the dedupe filter → 2 → fails.
    expect(userViews).toHaveLength(1)
    // The streamed row wins (stable DB id, not the temp id).
    expect(userViews[0].key).toBe("log-1")
  })

  it("keeps the optimistic bubble while its run has not yet streamed back", () => {
    const optimistic: OptimisticMessage[] = [
      { tempId: "tmp_2", text: "pending msg", createdAt: 1000, status: "sent", runId: "run-Y" },
    ]
    const views = reconcileChatMessages(optimistic, [], "Dev Commander")
    expect(views).toHaveLength(1)
    expect(views[0].key).toBe("tmp_2")
    expect(views[0].sender).toBe("user")
    expect(views[0].senderName).toBe("You")
  })

  it("keeps an un-acked optimistic bubble (no runId yet) even if some other message reconciled", () => {
    const optimistic: OptimisticMessage[] = [
      { tempId: "tmp_a", text: "sending now", createdAt: 2000, status: "sending" },
      { tempId: "tmp_b", text: "already acked", createdAt: 1000, status: "sent", runId: "run-Z" },
    ]
    const rows: ChatRow[] = [
      {
        id: "log-z",
        actionType: "MESSAGE_RECEIVED",
        timestamp: "2026-06-22T08:00:01.000Z",
        agentName: "System",
        action: "Received from : already acked",
        detail: "already acked",
        messageId: "run-Z",
      },
    ]
    const views = reconcileChatMessages(optimistic, rows, "Dev Commander")
    // tmp_b reconciled away; tmp_a (still sending) stays; plus the streamed row.
    expect(views.map((v) => v.key).sort()).toEqual(["log-z", "tmp_a"])
  })

  it("labels MESSAGE_SENT as the orchestrator, MESSAGE_RECEIVED as You, ordered by timestamp", () => {
    const rows: ChatRow[] = [
      {
        id: "u1",
        actionType: "MESSAGE_RECEIVED",
        timestamp: "2026-06-22T08:00:00.000Z",
        agentName: "System",
        action: "Received from : hi",
        detail: "hi",
        messageId: "r1",
      },
      {
        id: "a1",
        actionType: "MESSAGE_SENT",
        timestamp: "2026-06-22T08:00:05.000Z",
        agentName: "Dev Commander",
        action: "Replied: hey there",
        detail: "hey there",
        messageId: null,
      },
    ]
    const views = reconcileChatMessages([], rows, "Dev Commander")
    expect(views.map((v) => v.sender)).toEqual(["user", "agent"])
    expect(views[0].senderName).toBe("You")
    expect(views[1].senderName).toBe("Dev Commander")
    expect(views[1].detail).toBe("hey there")
  })
})

describe("ChatPanel — composer", () => {
  it("disables the composer and shows a note when the workspace is not sendable", () => {
    render(<ChatPanel workspaceId="ws-1" status="HIBERNATED" rows={[]} orchestratorName="Dev Commander" />)
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })

  it("enables the composer when RUNNING", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)
  })

  it("marks the optimistic bubble failed (and does NOT throw) when the send returns 409", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ success: false, error: { code: "WORKSPACE_TRANSITIONING" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    // Optimistic bubble appears immediately, then flips to failed.
    expect(await screen.findByText("hello")).toBeTruthy()
    expect(await screen.findByText(/Failed to send/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/chat",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("shows the optimistic bubble as sent (no failure) on a 202", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true, data: { runId: "run-1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi there" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText("hi there")).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Failed to send/i)).toBeNull()
  })

  it("renders a streamed agent reply from rows", () => {
    const rows: ChatRow[] = [
      {
        id: "a1",
        actionType: "MESSAGE_SENT",
        timestamp: "2026-06-22T08:00:05.000Z",
        agentName: "Dev Commander",
        action: "Replied: on it",
        detail: "On it — pulling the latest now.",
        messageId: null,
      },
    ]
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" />)
    expect(screen.getByText("On it — pulling the latest now.")).toBeTruthy()
    expect(screen.getByText("Dev Commander")).toBeTruthy()
  })
})
