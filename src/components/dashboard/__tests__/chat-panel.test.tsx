// @vitest-environment jsdom
//
// PR-9/B ChatPanel: (1) the optimistic-dedupe invariant (reconcileChatMessages)
// and (2) composer behavior (disabled when not sendable; failed bubble on a
// non-202 send, never a throw).

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react"
import {
  ChatPanel,
  reconcileChatMessages,
  mergePersistedChatRows,
  computeTurnStatuses,
  hasPendingTurn,
  isNearBottom,
  preservePrependedScrollPosition,
  chatUnavailableCopy,
  statusToReason,
  errorCodeToReason,
  PENDING_TURN_TIMEOUT_MS,
  fitChatComposer,
  composerLineBox,
  COMPOSER_MIN_HEIGHT_PX,
  COMPOSER_MAX_HEIGHT_PX,
  COMPOSER_MAX_ROWS,
  type ChatRow,
  type ChatMessageView,
  type OptimisticMessage,
} from "@/components/dashboard/chat-panel"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ChatPanel header", () => {
  it("labels the panel as web chat and points channel conversations to the activity feed", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)

    expect(screen.getByRole("heading", { name: "Web chat" })).toBeTruthy()
    expect(
      screen.getByText("Direct line to Dev Commander. Conversations on connected channels appear in the activity feed."),
    ).toBeTruthy()
  })

  it("shows a jump-to-latest pill when the user scrolls up", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" fullHeight />)
    const log = screen.getByRole("log")
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 })
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 300 })
    Object.defineProperty(log, "scrollTop", { configurable: true, value: 100 })

    fireEvent.scroll(log)

    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy()
  })

  it("fullHeight bounds the pane with max-h calc and keeps the list as flex scroll region", () => {
    const rows: ChatRow[] = Array.from({ length: 40 }, (_, i) => ({
      id: `m-${i}`,
      timestamp: `2026-07-01T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
      agentName: i % 2 === 0 ? "You" : "Dev Commander",
      agentSlug: i % 2 === 0 ? null : "orchestrator",
      action: `msg ${i}`,
      actionType: i % 2 === 0 ? "MESSAGE_RECEIVED" : "MESSAGE_SENT",
      detail: `body ${i}`,
      channelId: "webchat",
      runId: `run-${i}`,
    }))
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" fullHeight />)

    const pane = screen.getByRole("region", { name: "Web chat" })
    // MUTATION: strip max-h-[calc(100vh-260px)] → this fails.
    expect(pane.className).toContain("max-h-[calc(100vh-260px)]")
    expect(pane.className).toContain("flex")
    expect(pane.className).not.toContain("min-h-[calc(100vh-260px)]")

    const log = screen.getByRole("log")
    expect(log.className).toContain("flex-1")
    expect(log.className).toContain("min-h-0")
    expect(log.className).toContain("overflow-y-auto")
    expect(log.className).not.toContain("max-h-none")
  })

  it("full-height chat keeps the message list as the scroll region and composer visible", () => {
    const rows: ChatRow[] = Array.from({ length: 100 }, (_, i) => ({
      id: `m-${i}`,
      actionType: i % 2 === 0 ? "MESSAGE_RECEIVED" : "MESSAGE_SENT",
      timestamp: `2026-07-07T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
      agentName: "Dev Commander",
      action: `Message ${i}`,
      detail: `Message ${i}`,
      messageId: i % 2 === 0 ? `r-${i}` : null,
      runId: i % 2 === 1 ? `r-${i - 1}` : null,
      channelId: "webchat",
    }))

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" fullHeight />)

    expect(screen.getByRole("log").className).toContain("flex-1")
    expect(screen.getByLabelText("Message")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
  })
})

describe("reconcileChatMessages - optimistic dedupe by messageId === runId", () => {
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
    // Exactly ONE - not 2. MUTATION: remove the dedupe filter → 2 → fails.
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

  it("drops assistant NO_REPLY rows so protocol tokens never render in web chat", () => {
    const rows: ChatRow[] = [
      {
        id: "u1",
        actionType: "MESSAGE_RECEIVED",
        timestamp: "2026-06-22T08:00:00.000Z",
        agentName: "System",
        action: "Received from : boot check",
        detail: "boot check",
        messageId: "r1",
      },
      {
        id: "a1",
        actionType: "MESSAGE_SENT",
        timestamp: "2026-06-22T08:00:01.000Z",
        agentName: "Dev Commander",
        action: "Replied: NO_REPLY",
        detail: "  NO_REPLY  ",
        runId: "r1",
      },
      {
        id: "a2",
        actionType: "MESSAGE_SENT",
        timestamp: "2026-06-22T08:00:02.000Z",
        agentName: "Dev Commander",
        action: "Replied: ready",
        detail: "Ready for messages.",
        runId: "r2",
      },
    ]

    const views = reconcileChatMessages([], rows, "Dev Commander")

    expect(views.map((v) => v.key)).toEqual(["u1", "a2"])
    expect(JSON.stringify(views)).not.toContain("NO_REPLY")
  })

  it("multi-tab lock: a tab with NO optimistic state renders streamed MESSAGE_RECEIVED exactly once as You", () => {
    const rows: ChatRow[] = [
      {
        id: "tab-b-row",
        actionType: "MESSAGE_RECEIVED",
        timestamp: "2026-06-22T08:00:00.000Z",
        agentName: "System",
        action: "Received from : hello from tab A",
        detail: "hello from tab A",
        messageId: "run-tab-a",
      },
    ]
    const views = reconcileChatMessages([], rows, "Dev Commander")
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      key: "tab-b-row",
      sender: "user",
      senderName: "You",
      detail: "hello from tab A",
    })
  })

  it("three-source dedupe: history row + SSE row + optimistic bubble render one user message", () => {
    const persisted: ChatRow = {
      id: "same-db-row",
      actionType: "MESSAGE_RECEIVED",
      timestamp: "2026-06-22T08:00:00.000Z",
      agentName: "System",
      action: "Received from : already acked",
      detail: "already acked",
      messageId: "run-3source",
    }
    const merged = mergePersistedChatRows([persisted], [{ ...persisted }])
    const optimistic: OptimisticMessage[] = [
      { tempId: "tmp_3source", text: "already acked", createdAt: 999, status: "sent", runId: "run-3source" },
    ]

    expect(merged).toHaveLength(1)
    const views = reconcileChatMessages(optimistic, merged, "Dev Commander")
    expect(views.filter((v) => v.sender === "user")).toHaveLength(1)
    expect(views[0].key).toBe("same-db-row")
  })
})

describe("fitChatComposer - grow to 6 lines then inner scroll", () => {
  function mockTextarea(scrollHeight: number): HTMLTextAreaElement {
    const el = document.createElement("textarea")
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight })
    return el
  }

  it("clamps a short draft to the 2-line floor", () => {
    const fitted = fitChatComposer(mockTextarea(24))
    expect(fitted.height).toBe(COMPOSER_MIN_HEIGHT_PX)
    expect(fitted.overflowY).toBe("hidden")
  })

  it("grows with content between 2 and 6 lines (MUTATION: frozen at 2 rows -> fail)", () => {
    expect(COMPOSER_MAX_ROWS).toBe(6)
    expect(COMPOSER_MAX_HEIGHT_PX).toBeGreaterThan(COMPOSER_MIN_HEIGHT_PX)
    const mid = COMPOSER_MIN_HEIGHT_PX + 32
    const fitted = fitChatComposer(mockTextarea(mid))
    expect(fitted.height).toBe(mid)
    expect(fitted.overflowY).toBe("hidden")
  })

  it("freezes at 6 lines and scrolls inside when content is taller", () => {
    const fitted = fitChatComposer(mockTextarea(COMPOSER_MAX_HEIGHT_PX + 80))
    expect(fitted.height).toBe(COMPOSER_MAX_HEIGHT_PX)
    expect(fitted.overflowY).toBe("auto")
  })

  it("taller computed line-height raises the 6-line cap (MUTATION: hardcode 112px only -> fail)", () => {
    const box = composerLineBox({ lineHeight: "20px", paddingTop: "8px", paddingBottom: "8px" })
    expect(box.maxH).toBe(16 + 20 * 6)
    expect(box.maxH).toBeGreaterThan(COMPOSER_MAX_HEIGHT_PX)
  })

  it("measures with height 0 and maxHeight none so CSS max-h cannot freeze scrollHeight", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/components/dashboard/chat-panel.tsx"), "utf8")
    expect(src).toContain('el.style.height = "0px"')
    expect(src).toContain('el.style.maxHeight = "none"')
    expect(src).not.toContain("max-h-[112px]")
  })

  it("applies the grown height on the live composer after typing", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement
    const mid = COMPOSER_MIN_HEIGHT_PX + 32
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => mid })
    fireEvent.change(textarea, { target: { value: "line one\nline two\nline three\nline four" } })
    expect(textarea.style.height).toBe(`${mid}px`)
    expect(textarea.style.overflowY).toBe("hidden")
  })
})

describe("ChatPanel - composer", () => {
  it("enables the composer when RUNNING", () => {
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)
  })

  it("marks the bubble failed via the catch path when fetch rejects (network error) - NO unhandled rejection", async () => {
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
        detail: "On it - pulling the latest now.",
        messageId: null,
      },
    ]
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" />)
    expect(screen.getByText("On it - pulling the latest now.")).toBeTruthy()
    expect(screen.getByText("Dev Commander")).toBeTruthy()
  })

  it("does not render NO_REPLY from streamed assistant rows", () => {
    const rows: ChatRow[] = [
      {
        id: "a1",
        actionType: "MESSAGE_SENT",
        timestamp: "2026-06-22T08:00:05.000Z",
        agentName: "Dev Commander",
        action: "Replied: NO_REPLY",
        detail: "NO_REPLY",
        messageId: null,
      },
    ]
    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" />)

    expect(screen.queryByText("NO_REPLY")).toBeNull()
    expect(screen.getByText("No messages yet. Say hello to get started.")).toBeTruthy()
  })

  it("false-empty regression: endpoint-backed history shows chat even when SSE init has no webchat rows", async () => {
    // This models the real WIRE-TEST bug: the dashboard page's SSE init can pass
    // rows=[] to ChatPanel because the last-50 all-activity window contains only
    // non-chat activity. The chat-specific history endpoint still returns older
    // webchat rows, so a returning user does not see a false "No messages yet".
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          rows: [
            {
              id: "history-user-1",
              actionType: "MESSAGE_RECEIVED",
              timestamp: "2026-06-22T08:00:00.000Z",
              agentName: "System",
              action: "Received from : old hello",
              detail: "old hello",
              messageId: "run-history-1",
              channelId: "webchat",
              runId: null,
            },
          ],
          nextCursor: null,
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ChatPanel
        workspaceId="ws-1"
        status="RUNNING"
        rows={[]}
        orchestratorName="Dev Commander"
        historyEnabled
      />,
    )

    expect(await screen.findByText("old hello")).toBeTruthy()
    expect(screen.queryByText(/No messages yet/i)).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1/chat/history?limit=30")
  })

  it("rendered three-source dedupe: history row + SSE row + optimistic bubble render exactly one bubble", async () => {
    const sameMessage: ChatRow = {
      id: "same-db-row-rendered",
      actionType: "MESSAGE_RECEIVED",
      timestamp: "2026-06-22T08:00:00.000Z",
      agentName: "System",
      action: "Received from : already acked",
      detail: "already acked",
      messageId: "run-3source-rendered",
      channelId: "webchat",
      runId: null,
    }
    const fetchMock = vi
      .fn()
      // Source 1: initial history fetch returns the persisted row.
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { rows: [sameMessage], nextCursor: null },
        }),
      })
      // Source 3: sending creates an optimistic bubble, then the 202 assigns
      // the same runId used by the persisted MESSAGE_RECEIVED.messageId.
      .mockResolvedValueOnce({
        status: 202,
        json: async () => ({ success: true, data: { runId: "run-3source-rendered" } }),
      })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ChatPanel
        workspaceId="ws-1"
        status="RUNNING"
        // Source 2: SSE stream delivers the exact same ActivityLog row.
        rows={[sameMessage]}
        orchestratorName="Dev Commander"
        historyEnabled
      />,
    )

    expect(await screen.findByText("already acked")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "already acked" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    // Mutation: drop persisted id-dedupe in mergePersistedChatRows (or dedupe by
    // timestamp instead of ActivityLog.id) -> history + SSE render as two
    // persisted bubbles, and the optimistic bubble may add a third until acked.
    await waitFor(() => {
      expect(screen.getAllByText("already acked")).toHaveLength(1)
    })
  })

  it("Load earlier messages fetches before=nextCursor and prepends older history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            rows: [
              {
                id: "history-new",
                actionType: "MESSAGE_RECEIVED",
                timestamp: "2026-06-22T08:02:00.000Z",
                agentName: "System",
                action: "Received from : newer",
                detail: "newer",
                messageId: "run-new",
                channelId: "webchat",
                runId: null,
              },
            ],
            nextCursor: "cursor-older",
          },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: {
            rows: [
              {
                id: "history-old",
                actionType: "MESSAGE_RECEIVED",
                timestamp: "2026-06-22T08:01:00.000Z",
                agentName: "System",
                action: "Received from : older",
                detail: "older",
                messageId: "run-old",
                channelId: "webchat",
                runId: null,
              },
            ],
            nextCursor: null,
          },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ChatPanel
        workspaceId="ws-1"
        status="RUNNING"
        rows={[]}
        orchestratorName="Dev Commander"
        historyEnabled
      />,
    )

    expect(await screen.findByText("newer")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }))

    expect(await screen.findByText("older")).toBeTruthy()
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workspaces/ws-1/chat/history?limit=30&before=cursor-older",
    )
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull()
  })
})

describe("ChatPanel - per-state disabled copy + inline Wake (9/C)", () => {
  // Each non-sendable rendered status shows its OWN tailored copy (not the
  // generic 9/B line), composer disabled. Only HIBERNATED offers the inline
  // Wake CTA; WAKING/DEPLOYING self-resolve and PAUSED is unreachable.
  // MUTATION: revert to the single generic line → the specific-copy asserts fail.
  it.each<[string, RegExp, boolean]>([
    ["HIBERNATED", /asleep/i, true],
    ["WAKING", /unlocks automatically/i, false],
    ["DEPLOYING", /when it's live/i, false],
    ["PAUSED", /chat is paused/i, false],
  ])("status %s → its own copy, composer disabled, Wake button = %s", (status, copyRe, expectWake) => {
    render(
      <ChatPanel workspaceId="ws-1" status={status} rows={[]} orchestratorName="Dev Commander" onWake={() => {}} />,
    )
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByText(copyRe)).toBeTruthy()
    // The generic 9/B fallback must NOT appear for a mapped state.
    expect(screen.queryByText(/Chat is unavailable while your Claw is/i)).toBeNull()
    const wake = screen.queryByRole("button", { name: "Wake" })
    if (expectWake) expect(wake).toBeTruthy()
    else expect(wake).toBeNull()
  })

  it("HIBERNATED inline Wake button calls onWake when clicked", () => {
    const onWake = vi.fn()
    render(
      <ChatPanel workspaceId="ws-1" status="HIBERNATED" rows={[]} orchestratorName="Dev Commander" onWake={onWake} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Wake" }))
    // MUTATION: wire the button to anything but onWake (or drop the call) → fails.
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it("wake transition lock: composer enables when status rerenders from WAKING to RUNNING", () => {
    const { rerender } = render(
      <ChatPanel workspaceId="ws-1" status="WAKING" rows={[]} orchestratorName="Dev Commander" onWake={() => {}} />,
    )
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true)

    rerender(
      <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" onWake={() => {}} />,
    )
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(false)
  })

  it("omits the Wake button when no onWake is provided (graceful), still shows the copy", () => {
    render(<ChatPanel workspaceId="ws-1" status="HIBERNATED" rows={[]} orchestratorName="Dev Commander" />)
    expect(screen.queryByRole("button", { name: "Wake" })).toBeNull()
    expect(screen.getByText(/asleep/i)).toBeTruthy()
  })

  it("falls back to the generic line for an unmapped non-sendable status", () => {
    render(<ChatPanel workspaceId="ws-1" status="SOME_FUTURE_STATE" rows={[]} orchestratorName="Dev Commander" />)
    expect(screen.getByText(/Chat is unavailable while your Claw is some_future_state/i)).toBeTruthy()
  })
})

describe("ChatPanel - send-time per-code copy + Retry (9/C)", () => {
  // A non-202 send renders the SAME tailored copy as the disabled composer,
  // keyed off the response error.code - NOT a flat "Failed to send". This is the
  // mid-compose race (a RUNNING Claw that changed state between compose & send).
  // MUTATION: ignore error.code in performSend → reverts to the generic line →
  // every per-code assertion below fails.
  it.each<[number, string, RegExp]>([
    [409, "WORKSPACE_HIBERNATED", /asleep/i],
    [409, "WORKSPACE_STOPPED", /stopped/i],
    [409, "WORKSPACE_TRANSITIONING", /starting up/i],
    [502, "GATEWAY_UNREACHABLE", /can't reach your claw/i],
    [429, "RATE_LIMITED", /too many messages/i],
  ])("send %i %s → failed bubble shows the tailored copy (not 'Failed to send')", async (status, code, copyRe) => {
    const fetchMock = vi.fn().mockResolvedValue({
      status,
      json: async () => ({ success: false, error: { code } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText("hello")).toBeTruthy() // body preserved
    expect(await screen.findByText(copyRe)).toBeTruthy() // tailored, per-code copy
    expect(screen.queryByText("Failed to send")).toBeNull() // not the generic line
  })

  it("a 502 failed bubble shows Retry; clicking it re-POSTs the SAME text and clears the failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 502,
        json: async () => ({ success: false, error: { code: "GATEWAY_UNREACHABLE" } }),
      })
      .mockResolvedValueOnce({
        status: 202,
        json: async () => ({ success: true, data: { runId: "run-1" } }),
      })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "ping the claw" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    const retryBtn = await screen.findByRole("button", { name: "Retry" })
    expect(await screen.findByText(/can't reach your claw/i)).toBeTruthy()
    fireEvent.click(retryBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // MUTATION: retry sends empty/wrong text (not the failed bubble's text) → fails.
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    expect(secondBody.message).toBe("ping the claw")
    // The retried send succeeded → the failure copy clears.
    await waitFor(() => expect(screen.queryByText(/can't reach your claw/i)).toBeNull())
  })

  it("send 409 WORKSPACE_HIBERNATED → failed bubble shows the asleep copy AND a Wake button; clicking calls onWake", async () => {
    const onWake = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ success: false, error: { code: "WORKSPACE_HIBERNATED" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" onWake={onWake} />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText(/asleep/i)).toBeTruthy()
    const wakeBtn = await screen.findByRole("button", { name: "Wake" })
    // Hibernated mid-compose is a Wake, NOT a Retry (a resend would 409 again) -
    // symmetric to the pre-send disabled state, reusing the SAME onWake.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    fireEvent.click(wakeBtn)
    // MUTATION: don't render the Wake button when failure.cta === "wake" →
    // findByRole("Wake") throws; drop the onWake wiring → this expectation fails.
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it("a send-time hibernated bubble omits Wake when no onWake is provided (graceful), still shows the copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ success: false, error: { code: "WORKSPACE_HIBERNATED" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[]} orchestratorName="Dev Commander" />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByText(/asleep/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Wake" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })
})

describe("9/C reason mappers - one copy, two surfaces", () => {
  it("maps each workspace status to its reason (pre-send)", () => {
    expect(statusToReason("HIBERNATED")).toBe("asleep")
    expect(statusToReason("WAKING")).toBe("waking")
    expect(statusToReason("DEPLOYING")).toBe("deploying")
    expect(statusToReason("PAUSED")).toBe("paused")
    expect(statusToReason("STOPPED")).toBe("stopped")
    expect(statusToReason("RUNNING")).toBe("unknown") // sendable - never rendered
  })

  it("maps each send error.code to the SAME reason set (send-time)", () => {
    expect(errorCodeToReason("WORKSPACE_HIBERNATED")).toBe("asleep")
    expect(errorCodeToReason("WORKSPACE_STOPPED")).toBe("stopped")
    expect(errorCodeToReason("WORKSPACE_TRANSITIONING")).toBe("transitioning")
    expect(errorCodeToReason("GATEWAY_UNREACHABLE")).toBe("unreachable")
    expect(errorCodeToReason("RATE_LIMITED")).toBe("rate_limited")
    expect(errorCodeToReason(undefined)).toBe("unknown") // network error
    expect(errorCodeToReason("SOMETHING_NEW")).toBe("unknown")
  })

  it("HIBERNATED (status) and WORKSPACE_HIBERNATED (code) resolve to identical copy", () => {
    const pre = chatUnavailableCopy(statusToReason("HIBERNATED"))
    const send = chatUnavailableCopy(errorCodeToReason("WORKSPACE_HIBERNATED"))
    expect(pre.message).toBe(send.message)
    expect(pre.message).toMatch(/asleep/i)
    expect(pre.cta).toBe("wake")
  })

  it("only asleep carries a wake CTA; transient reasons carry retry; quiet states none", () => {
    expect(chatUnavailableCopy("asleep").cta).toBe("wake")
    expect(chatUnavailableCopy("unreachable").cta).toBe("retry")
    expect(chatUnavailableCopy("transitioning").cta).toBe("retry")
    expect(chatUnavailableCopy("rate_limited").cta).toBe("retry")
    expect(chatUnavailableCopy("waking").cta).toBeUndefined()
    expect(chatUnavailableCopy("deploying").cta).toBeUndefined()
    expect(chatUnavailableCopy("paused").cta).toBeUndefined()
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

describe("computeTurnStatuses - per-runId, time-bounded pending (working-indicator fix)", () => {
  const T = Date.parse("2026-06-22T08:00:00.000Z") // fixed "now"
  const within = T - 10_000 // 10s ago → inside the 2-min window
  const past = T - (PENDING_TURN_TIMEOUT_MS + 60_000) // well past the window

  const userView = (
    runId: string | null,
    sortTs: number,
    status?: "sending" | "sent" | "failed",
  ): ChatMessageView => ({
    key: "u-" + runId, sender: "user", senderName: "You", sortTs, detail: "", action: "", status, runId,
  })
  const agentView = (runId: string, sortTs: number): ChatMessageView => ({
    key: "a-" + runId, sender: "agent", senderName: "X", sortTs, detail: "", action: "", runId,
  })

  // ORPHAN REGRESSION - the exact live bug. A started user turn with no
  // MESSAGE_SENT, timestamped past the window, is "no_response" → indicator OFF.
  // The OLD count-based logic returned working=true here (started 1 > replied 0)
  // and stuck forever. This asserts the new behavior the old code FAILS.
  it("orphan past the window → no_response, NOT pending (the stuck-forever bug)", () => {
    const st = computeTurnStatuses([userView("rA", past, "sent")], T)
    expect(st.get("rA")).toBe("no_response")
    expect(hasPendingTurn(st)).toBe(false)
  })

  // PER-RUNID RESOLVE - a recent send is pending; the reply carrying the SAME
  // runId resolves it.
  it("recent send with no reply → pending; matching MESSAGE_SENT.runId → resolved", () => {
    expect(hasPendingTurn(computeTurnStatuses([userView("rB", within, "sent")], T))).toBe(true)
    const resolved = computeTurnStatuses(
      [userView("rB", within, "sent"), agentView("rB", within + 5_000)],
      T,
    )
    expect(resolved.has("rB")).toBe(false)
    expect(hasPendingTurn(resolved)).toBe(false)
  })

  it("a reply with a DIFFERENT runId does NOT resolve the turn (correlation is by runId)", () => {
    // MUTATION: resolve on any agent reply (ignore runId) → this turn resolves
    // and hasPendingTurn flips false → fails.
    const st = computeTurnStatuses(
      [userView("rB", within, "sent"), agentView("rOTHER", within + 5_000)],
      T,
    )
    expect(st.get("rB")).toBe("pending")
    expect(hasPendingTurn(st)).toBe(true)
  })

  // INDEPENDENCE - THE live bug: an earlier orphaned turn must not keep the
  // indicator on once a later turn has replied.
  it("orphaned earlier turn + replied later turn → indicator OFF (independence)", () => {
    const st = computeTurnStatuses(
      [
        userView("rA", past, "sent"), // orphan, never replied
        userView("rB", within, "sent"), // later turn
        agentView("rB", within + 5_000), // later turn's reply
      ],
      T,
    )
    expect(st.get("rA")).toBe("no_response")
    expect(st.has("rB")).toBe(false)
    expect(hasPendingTurn(st)).toBe(false) // NOT stuck on rA - the old bug
  })

  it("a genuinely-pending later turn keeps the indicator on via ITS OWN pending, not the orphan", () => {
    const st = computeTurnStatuses(
      [userView("rA", past, "sent"), userView("rB", within, "sent")],
      T,
    )
    expect(st.get("rA")).toBe("no_response")
    expect(st.get("rB")).toBe("pending")
    expect(hasPendingTurn(st)).toBe(true)
  })

  // TIMEOUT - same turn, evaluated before vs after the ceiling.
  it("pending within the window flips to no_response past PENDING_TURN_TIMEOUT_MS", () => {
    const views = [userView("rC", T, "sent")]
    expect(computeTurnStatuses(views, T + 10_000).get("rC")).toBe("pending")
    // MUTATION: drop the timeout (always pending) → this line fails.
    expect(computeTurnStatuses(views, T + PENDING_TURN_TIMEOUT_MS + 1).get("rC")).toBe("no_response")
  })

  it("does not track pre-202 (sending), failed, or keyless user turns", () => {
    expect(computeTurnStatuses([userView("rD", within, "sending")], T).size).toBe(0)
    expect(computeTurnStatuses([userView("rE", within, "failed")], T).size).toBe(0)
    expect(computeTurnStatuses([userView(null, within, "sent")], T).size).toBe(0)
  })

  it("streamed MESSAGE_RECEIVED (status undefined) counts as a started turn", () => {
    expect(computeTurnStatuses([userView("rF", within, undefined)], T).get("rF")).toBe("pending")
  })
})

describe("ChatPanel - working indicator (per-runId + timeout)", () => {
  // Rows are timestamped relative to a FAKED wall clock so the time-bounded
  // pending logic is deterministic. The user send carries the turn key as
  // messageId (=== runId); the agent reply carries it as runId.
  const BASE = Date.parse("2026-06-22T08:00:00.000Z")
  const iso = (ms: number) => new Date(ms).toISOString()
  const userRow = (runId: string, agoMs: number): ChatRow => ({
    id: "u-" + runId, actionType: "MESSAGE_RECEIVED", timestamp: iso(BASE - agoMs),
    agentName: "System", action: "Received from : hi", detail: "hi", messageId: runId,
  })
  const replyRow = (runId: string, agoMs: number, text = "hey there"): ChatRow => ({
    id: "a-" + runId, actionType: "MESSAGE_SENT", timestamp: iso(BASE - agoMs),
    agentName: "Dev Commander", action: "Replied: " + text, detail: text, runId,
  })

  it("shows the indicator while a recent user turn is unreplied", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("r1", 10_000)]} orchestratorName="Dev Commander" />)
      expect(screen.getByText(/is working/i)).toBeTruthy()
      expect(screen.queryByText("No response")).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it("resolves the indicator when MESSAGE_SENT with the MATCHING runId arrives", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      const { rerender } = render(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("r1", 10_000)]} orchestratorName="Dev Commander" />,
      )
      expect(screen.getByText(/is working/i)).toBeTruthy()
      rerender(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("r1", 10_000), replyRow("r1", 5_000)]} orchestratorName="Dev Commander" />,
      )
      expect(screen.queryByText(/is working/i)).toBeNull()
      expect(screen.getByText("hey there")).toBeTruthy()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it("does NOT stick on a single OLD orphaned turn - indicator off, shows quiet 'No response'", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("rOLD", PENDING_TURN_TIMEOUT_MS + 60_000)]} orchestratorName="Dev Commander" />)
      expect(screen.queryByText(/is working/i)).toBeNull()
      expect(screen.getByText("No response")).toBeTruthy()
      expect(screen.queryByText("Failed to send")).toBeNull() // NOT a send failure
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  // THE live bug: an earlier orphaned turn must not hold the indicator on once a
  // later turn has replied. MUTATION: count-based logic → started 2 > replied 1
  // → stuck ON → this fails.
  it("indicator OFF when an earlier turn is orphaned but a later turn replied (the live bug)", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      const rows = [
        userRow("rOLD", PENDING_TURN_TIMEOUT_MS + 120_000), // orphan, no reply
        userRow("rNEW", 10_000),
        replyRow("rNEW", 5_000, "done"),
      ]
      render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={rows} orchestratorName="Dev Commander" />)
      expect(screen.queryByText(/is working/i)).toBeNull() // not stuck on the orphan
      expect(screen.getByText("No response")).toBeTruthy() // orphan annotated
      expect(screen.getByText("done")).toBeTruthy() // later reply rendered
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  // TIMEOUT via the live tick: a pending turn flips to "No response" after the
  // ceiling WITHOUT a new message. MUTATION: remove the timeout → stays "working".
  it("times out a pending turn after PENDING_TURN_TIMEOUT_MS → indicator off + 'No response'", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("rT", 5_000)]} orchestratorName="Dev Commander" />)
      expect(screen.getByText(/is working/i)).toBeTruthy()
      expect(screen.queryByText("No response")).toBeNull()

      // The re-eval tick fires across the ceiling and recomputes - no new row.
      act(() => {
        vi.advanceTimersByTime(PENDING_TURN_TIMEOUT_MS + 30_000)
      })

      expect(screen.queryByText(/is working/i)).toBeNull()
      expect(screen.getByText("No response")).toBeTruthy()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  // A late reply (past the timeout) is NOT rejected - it renders and clears the
  // "No response" note when it finally streams in.
  it("a LATE reply after timeout still renders the reply bubble and clears 'No response'", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      const { rerender } = render(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("rL", PENDING_TURN_TIMEOUT_MS + 60_000)]} orchestratorName="Dev Commander" />,
      )
      expect(screen.queryByText(/is working/i)).toBeNull()
      expect(screen.getByText("No response")).toBeTruthy()

      rerender(
        <ChatPanel workspaceId="ws-1" status="RUNNING" rows={[userRow("rL", PENDING_TURN_TIMEOUT_MS + 60_000), replyRow("rL", 1_000, "late but here")]} orchestratorName="Dev Commander" />,
      )
      expect(screen.getByText("late but here")).toBeTruthy()
      expect(screen.queryByText("No response")).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  // D6 2026-08-23 webchat-silent polish: a TIMED-OUT turn (202 accepted,
  // container-side turn died - the founder's missing-OpenRouter-key incident)
  // must offer Retry. Retry re-sends the SAME text as a NEW send (fresh
  // idempotencyKey server-side). MUTATION: reusing the dead turn's runId
  // would make the gateway dedupe the retry into the dead run - the new
  // pending turn asserted here would never exist.
  it("timed-out turn offers Retry that re-sends the SAME text as a NEW turn (D6 webchat-silent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true, data: { runId: "run-retry-1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)
    // Real timers: the row is simply timestamped past the pending ceiling.
    const dead: ChatRow = {
      id: "u-dead",
      actionType: "MESSAGE_RECEIVED",
      timestamp: new Date(Date.now() - PENDING_TURN_TIMEOUT_MS - 60_000).toISOString(),
      agentName: "System",
      action: "Received from : hello",
      detail: "hello",
      messageId: "run-dead",
    }

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[dead]} orchestratorName="Dev Commander" />)
    expect(screen.getByText("No response")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/chat",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ message: "hello" }) }),
      )
    })
    // The retry renders its own bubble (same text, second instance) and
    // re-arms the working indicator for the NEW verified in-flight turn.
    expect(await screen.findByText(/is working/i)).toBeTruthy()
    expect(screen.getAllByText("hello").length).toBe(2)
  })

  it("a timed-out turn's Retry is wired even for streamed rows with empty detail (falls back to action text)", async () => {
    // Defensive: detail null → the panel resends `action`. A blank resend
    // would 400 server-side; resend() guards the empty string.
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      json: async () => ({ success: true, data: { runId: "run-retry-2" } }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const dead: ChatRow = {
      id: "u-dead2",
      actionType: "MESSAGE_RECEIVED",
      timestamp: new Date(Date.now() - PENDING_TURN_TIMEOUT_MS - 60_000).toISOString(),
      agentName: "System",
      action: "ping",
      detail: null,
      messageId: "run-dead2",
    }

    render(<ChatPanel workspaceId="ws-1" status="RUNNING" rows={[dead]} orchestratorName="Dev Commander" />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/chat",
        expect.objectContaining({ body: JSON.stringify({ message: "ping" }) }),
      )
    })
  })

  it("does NOT show the indicator on a non-sendable Claw (no false 'working' on stale history)", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(BASE)
      render(<ChatPanel workspaceId="ws-1" status="HIBERNATED" rows={[userRow("r1", 10_000)]} orchestratorName="Dev Commander" />)
      expect(screen.queryByText(/is working/i)).toBeNull()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })
})

describe("ChatPanel - scroll (GAP #3: container only, near-bottom guard)", () => {
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
      expect(scrollIntoView).not.toHaveBeenCalled() // no page jump - MUTATION: use scrollIntoView → fails
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

  it("load-older prepend preserves viewport by adding the scrollHeight delta to scrollTop", () => {
    let top = 120
    const el = {
      scrollHeight: 1300,
      get scrollTop() {
        return top
      },
      set scrollTop(v: number) {
        top = v
      },
    }

    preservePrependedScrollPosition(el, { scrollHeight: 1000, scrollTop: 120 })
    expect(top).toBe(420)
  })
})
