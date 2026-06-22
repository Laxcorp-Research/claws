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
  isAgentWorking,
  isNearBottom,
  type ChatRow,
  type ChatMessageView,
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

  // The composer must tolerate EVERY non-202 send response — the full 409
  // family (HIBERNATED / STOPPED / TRANSITIONING), 502 (gateway unreachable),
  // and 429 (rate limit) — by marking the bubble failed and NEVER throwing.
  // The component treats all non-202 identically; this matrix locks that the
  // whole set is handled (rich per-code copy is deferred to 9/C).
  it.each<[number, string]>([
    [409, "WORKSPACE_HIBERNATED"],
    [409, "WORKSPACE_STOPPED"],
    [409, "WORKSPACE_TRANSITIONING"],
    [502, "GATEWAY_UNREACHABLE"],
    [429, "RATE_LIMITED"],
  ])("marks the bubble failed (no throw) when the send returns %i %s", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue({
      status,
      json: async () => ({ success: false, error: { code } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    // Optimistic bubble appears immediately, then flips to failed — and the
    // message body is preserved (never blanked).
    expect(await screen.findByText("hello")).toBeTruthy()
    expect(await screen.findByText(/Failed to send/i)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/chat",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("marks the bubble failed via the catch path when fetch rejects (network error) — NO unhandled rejection", async () => {
    const onUnhandled = vi.fn()
    window.addEventListener("unhandledrejection", onUnhandled)
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"))
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "offline msg" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    // MUTATION: remove send()'s try/catch → the rejection is unhandled and the
    // bubble is never flipped to failed (stuck "Sending…") → this times out → fails.
    expect(await screen.findByText("offline msg")).toBeTruthy()
    expect(await screen.findByText(/Failed to send/i)).toBeTruthy()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    window.removeEventListener("unhandledrejection", onUnhandled)
    expect(onUnhandled).not.toHaveBeenCalled()
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

describe("isNearBottom (GAP #3 scroll guard)", () => {
  it("is true at/near the bottom (within threshold)", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 })).toBe(true) // 0 from bottom
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 640, clientHeight: 300 })).toBe(true) // 60 <= 80
  })
  it("is false when scrolled up beyond the threshold", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 300 })).toBe(false) // 500 > 80
  })
})

describe("isAgentWorking (GAP #2 pending)", () => {
  const u = (status?: "sending" | "sent" | "failed"): ChatMessageView => ({
    key: "u", sender: "user", senderName: "You", sortTs: 0, detail: "", action: "", status,
  })
  const a = (): ChatMessageView => ({
    key: "a", sender: "agent", senderName: "X", sortTs: 0, detail: "", action: "",
  })
  it("true while a started user turn has no reply", () => {
    expect(isAgentWorking([u("sent")])).toBe(true)
    expect(isAgentWorking([u(undefined)])).toBe(true) // streamed MESSAGE_RECEIVED
  })
  it("false once the reply arrives", () => {
    expect(isAgentWorking([u("sent"), a()])).toBe(false)
  })
  it("ignores sending (pre-202) and failed (no run started)", () => {
    expect(isAgentWorking([u("sending")])).toBe(false)
    expect(isAgentWorking([u("failed")])).toBe(false)
  })
  it("true under rapid sends (more user turns than replies)", () => {
    expect(isAgentWorking([u("sent"), u("sent"), a()])).toBe(true)
  })
})

describe("ChatPanel — working indicator (GAP #2)", () => {
  const userRow: ChatRow = {
    id: "u1", actionType: "MESSAGE_RECEIVED", timestamp: "2026-06-22T08:00:00.000Z",
    agentName: "System", action: "Received from : hi", detail: "hi", messageId: "r1",
  }
  const replyRow: ChatRow = {
    id: "a1", actionType: "MESSAGE_SENT", timestamp: "2026-06-22T08:00:05.000Z",
    agentName: "Dev Commander", action: "Replied: hey", detail: "hey there", messageId: null,
  }

  it("shows the agent working indicator while a user turn is unreplied", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow]} orchestratorName="Dev Commander" />)
    expect(screen.getByText(/is working/i)).toBeTruthy()
  })

  it("replaces the working indicator with the reply when MESSAGE_SENT arrives", () => {
    const { rerender } = render(
      <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow]} orchestratorName="Dev Commander" />,
    )
    expect(screen.getByText(/is working/i)).toBeTruthy()
    rerender(
      <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow, replyRow]} orchestratorName="Dev Commander" />,
    )
    expect(screen.queryByText(/is working/i)).toBeNull()
    expect(screen.getByText("hey there")).toBeTruthy()
  })

  it("does NOT show the working indicator on a non-sendable Claw (no false 'working' on stale history)", () => {
    render(<ChatPanel workspaceId="ws-1" status="HIBERNATED" rows={[userRow]} orchestratorName="Dev Commander" />)
    expect(screen.queryByText(/is working/i)).toBeNull()
  })
})

describe("ChatPanel — scroll (GAP #3: container only, near-bottom guard)", () => {
  const userRow: ChatRow = {
    id: "u1", actionType: "MESSAGE_RECEIVED", timestamp: "2026-06-22T08:00:00.000Z",
    agentName: "System", action: "Received from : hi", detail: "hi", messageId: "r1",
  }
  const replyRow: ChatRow = {
    id: "a1", actionType: "MESSAGE_SENT", timestamp: "2026-06-22T08:00:05.000Z",
    agentName: "Dev Commander", action: "Replied: hey", detail: "hey there", messageId: null,
  }

  // jsdom does no layout, so we instrument the container's scroll metrics and
  // record every scrollTop WRITE (robust to any jsdom clamping).
  function instrument(list: HTMLElement, initialTop: number): number[] {
    let top = initialTop
    const writes: number[] = []
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = v; writes.push(v) },
    })
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true })
    Object.defineProperty(list, "clientHeight", { value: 300, configurable: true })
    return writes
  }

  it("pins to bottom by scrolling the CONTAINER (never scrollIntoView) when near bottom", () => {
    const scrollIntoView = vi.fn()
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void }
    const orig = proto.scrollIntoView
    proto.scrollIntoView = scrollIntoView
    try {
      const { rerender } = render(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow]} orchestratorName="Dev Commander" />,
      )
      const list = screen.getByRole("log")
      const writes = instrument(list, 700) // 1000 - 700 - 300 = 0 → near bottom
      fireEvent.scroll(list)
      rerender(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow, replyRow]} orchestratorName="Dev Commander" />,
      )
      expect(writes).toContain(1000) // container scrolled to its own scrollHeight
      expect(scrollIntoView).not.toHaveBeenCalled() // no page jump — MUTATION: use scrollIntoView → fails
    } finally {
      proto.scrollIntoView = orig
    }
  })

  it("does NOT yank to bottom when the user has scrolled up to read history", () => {
    const { rerender } = render(
      <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow]} orchestratorName="Dev Commander" />,
    )
    const list = screen.getByRole("log")
    const writes = instrument(list, 100) // 1000 - 100 - 300 = 600 → scrolled up
    fireEvent.scroll(list)
    rerender(
      <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow, replyRow]} orchestratorName="Dev Commander" />,
    )
    expect(writes).not.toContain(1000) // left where the user put it
  })
})
