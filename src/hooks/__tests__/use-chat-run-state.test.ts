// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, cleanup, act, waitFor } from "@testing-library/react"
import {
  useChatRunState,
  CHAT_RUN_STATE_FALLBACK_BASE_MS,
} from "@/hooks/use-chat-run-state"
import { chatRunStateStreamUrl } from "@/lib/chat/run-state"

class MockEventSource {
  static instances: MockEventSource[] = []
  static reset() {
    MockEventSource.instances = []
  }

  url: string
  closed = false
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: data !== undefined ? JSON.stringify(data) : undefined } as MessageEvent)
    }
  }
}

function current(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]
}

const sent = (id: string, runId: string, text: string, channelId: string | null = "webchat") => ({
  id,
  actionType: "MESSAGE_SENT",
  timestamp: "2026-09-04T08:00:10.000Z",
  agentName: "Orchestrator",
  action: `Replied: ${text}`,
  detail: text,
  channelId,
  runId,
})

beforeEach(() => {
  vi.useFakeTimers()
  MockEventSource.reset()
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { rows: [] } }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("useChatRunState", () => {
  it("MUTATION: EventSource URL is the activity stream with chat-run-state scope", () => {
    renderHook(() => useChatRunState("ws-1", ["run-1"]))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(current().url).toBe(chatRunStateStreamUrl("ws-1"))
    expect(current().url).toContain("scope=chat-run-state")

    const src = readFileSync(join(process.cwd(), "src/hooks/use-chat-run-state.ts"), "utf8")
    expect(src).toContain("new EventSource(chatRunStateStreamUrl(workspaceId))")
    expect(src).toContain("setFallback")
  })

  it("merges init + log by id and does not replace the in-flight buffer", () => {
    const { result } = renderHook(() => useChatRunState("ws-1", ["run-1"]))

    act(() => {
      current().emit("open")
      current().emit("init", [
        {
          id: "recv-1",
          actionType: "MESSAGE_RECEIVED",
          timestamp: "2026-09-04T08:00:00.000Z",
          agentName: "System",
          action: "hi",
          detail: "hi",
          channelId: "webchat",
          messageId: "run-1",
        },
      ])
    })
    expect(result.current.rows.map((r) => r.id)).toEqual(["recv-1"])

    act(() => {
      current().emit("init", [
        {
          id: "start-1",
          actionType: "TASK_START",
          timestamp: "2026-09-04T08:00:05.000Z",
          agentName: "Orchestrator",
          action: "Task started",
          runId: "run-1",
        },
      ])
    })
    expect(result.current.rows.map((r) => r.id).sort()).toEqual(["recv-1", "start-1"])

    act(() => {
      current().emit("log", sent("sent-1", "run-1", "live reply without reload"))
    })
    expect(result.current.rows.some((r) => r.detail === "live reply without reload")).toBe(true)
  })

  it("keeps MESSAGE_SENT with runId even when channelId is missing", () => {
    const { result } = renderHook(() => useChatRunState("ws-1", ["run-1"]))
    act(() => {
      current().emit("open")
      current().emit("log", sent("sent-1", "run-1", "done without channel", null))
    })
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].detail).toBe("done without channel")
  })

  it("does not poll while SSE is live and the tab is visible", () => {
    renderHook(() => useChatRunState("ws-1", ["run-1"]))
    act(() => {
      current().emit("open")
    })
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("polls /chat/run-state only after SSE drops (fallback, not primary)", async () => {
    vi.useRealTimers()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { rows: [sent("sent-fb", "run-1", "fallback reply")] },
      }),
    })

    const { result } = renderHook(() => useChatRunState("ws-1", ["run-1"]))
    act(() => {
      current().emit("error")
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain("/api/workspaces/ws-1/chat/run-state")
    expect(url).toContain("runIds=run-1")
    await waitFor(() => {
      expect(result.current.rows.some((r) => r.detail === "fallback reply")).toBe(true)
    })
  })

  it("visibilitychange to visible triggers a catch-up poll", async () => {
    vi.useRealTimers()
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    renderHook(() => useChatRunState("ws-1", ["run-1"]))
    act(() => {
      current().emit("open")
    })
    fetchMock.mockClear()

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true })
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
      document.dispatchEvent(new Event("visibilitychange"))
    })
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false })
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/chat/run-state")
  })

  it("fallback backoff stays capped", async () => {
    renderHook(() => useChatRunState("ws-1", ["run-1"]))
    act(() => {
      current().emit("error")
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_RUN_STATE_FALLBACK_BASE_MS * 40)
    })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.length).toBeLessThan(20)
  })
})
