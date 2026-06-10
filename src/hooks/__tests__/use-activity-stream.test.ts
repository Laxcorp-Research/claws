// @vitest-environment jsdom
//
// PR-9/pre regression guard for the dashboard SSE reconnect bug: the old
// inline effect's `onerror` path constructed a replacement EventSource
// WITHOUT re-attaching any listeners (not even onerror), so after one
// transient disconnect the dashboard silently stopped receiving init/log
// events while appearing connected. These tests fail if that bug is
// reintroduced (verified by mutation: removing listener attachment from the
// reconnect path makes "reconnects after error AND still receives log
// events" fail).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, cleanup, act } from "@testing-library/react"
import {
  useActivityStream,
  RECONNECT_BASE_MS,
  RECONNECT_CAP_MS,
} from "@/hooks/use-activity-stream"

// ─── Controllable EventSource mock (jsdom has no EventSource) ──────────────

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

  /** Test helper: dispatch a named SSE event with a JSON payload. */
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: data !== undefined ? JSON.stringify(data) : undefined } as MessageEvent)
    }
  }

  listenerCount(type: string) {
    return (this.listeners.get(type) ?? []).length
  }
}

function current(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]
}

beforeEach(() => {
  vi.useFakeTimers()
  MockEventSource.reset()
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Entry = { id: string; action: string }

function renderStream(workspaceId = "ws-1") {
  const onInit = vi.fn()
  const onLog = vi.fn()
  const utils = renderHook(
    ({ id }: { id: string }) => useActivityStream<Entry>(id, { onInit, onLog }),
    { initialProps: { id: workspaceId } },
  )
  return { onInit, onLog, ...utils }
}

describe("useActivityStream", () => {
  it("connects to the workspace stream and delivers init + log events", () => {
    const { onInit, onLog } = renderStream("ws-abc")

    expect(MockEventSource.instances).toHaveLength(1)
    expect(current().url).toBe("/api/activity/ws-abc/stream")

    act(() => {
      current().emit("init", [{ id: "1", action: "a" }])
      current().emit("log", { id: "2", action: "b" })
    })

    expect(onInit).toHaveBeenCalledWith([{ id: "1", action: "a" }])
    expect(onLog).toHaveBeenCalledWith({ id: "2", action: "b" })
  })

  it("reconnects after error AND still receives log events (regression: listeners were lost on reconnect)", () => {
    const { onLog } = renderStream()
    const first = current()

    act(() => {
      first.emit("error")
    })
    expect(first.closed).toBe(true)

    // Reconnect happens after backoff, not immediately.
    expect(MockEventSource.instances).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(RECONNECT_BASE_MS)
    })
    expect(MockEventSource.instances).toHaveLength(2)

    // THE bug: the replacement connection must have working listeners.
    act(() => {
      current().emit("log", { id: "3", action: "after-reconnect" })
    })
    expect(onLog).toHaveBeenCalledWith({ id: "3", action: "after-reconnect" })

    // And the replacement must itself survive a SECOND error (old code's
    // replacement had no error handler at all → reconnection died forever).
    act(() => {
      current().emit("error")
      vi.advanceTimersByTime(RECONNECT_CAP_MS)
    })
    expect(MockEventSource.instances).toHaveLength(3)
    act(() => {
      current().emit("log", { id: "4", action: "after-second-reconnect" })
    })
    expect(onLog).toHaveBeenCalledWith({ id: "4", action: "after-second-reconnect" })
  })

  it("backs off exponentially: rapid consecutive errors do not create unbounded connections", () => {
    renderStream()

    // Fail every connection the instant it is created; advance time in 1s
    // steps for a full minute. With capped exponential backoff the number of
    // connections is logarithmic-ish (1+2+4+8+16+30 > 60s ⇒ ≤ 7 total);
    // the old flat-5s code would have made ~12, and a tight loop hundreds.
    for (let s = 0; s < 60; s++) {
      act(() => {
        const c = current()
        if (!c.closed) c.emit("error")
        vi.advanceTimersByTime(1_000)
      })
    }
    expect(MockEventSource.instances.length).toBeLessThanOrEqual(7)
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2)
  })

  it("resets backoff after a successful open", () => {
    renderStream()

    // Burn the first two attempts (delays 1s then 2s)…
    act(() => {
      current().emit("error")
      vi.advanceTimersByTime(RECONNECT_BASE_MS)
    })
    act(() => {
      current().emit("error")
      vi.advanceTimersByTime(2 * RECONNECT_BASE_MS)
    })
    expect(MockEventSource.instances).toHaveLength(3)

    // …then a successful open resets the attempt counter: the next error
    // reconnects after the BASE delay again, not 4s.
    act(() => {
      current().emit("open")
      current().emit("error")
      vi.advanceTimersByTime(RECONNECT_BASE_MS)
    })
    expect(MockEventSource.instances).toHaveLength(4)
  })

  it("teardown closes the live connection and cancels a pending reconnect", () => {
    const { unmount } = renderStream()
    const first = current()

    // Leave a reconnect pending, then unmount.
    act(() => {
      first.emit("error")
    })
    unmount()

    act(() => {
      vi.advanceTimersByTime(RECONNECT_CAP_MS * 2)
    })
    // No connection created after unmount; nothing leaked.
    expect(MockEventSource.instances).toHaveLength(1)
    expect(first.closed).toBe(true)
  })

  it("teardown closes the CURRENT connection after reconnects (not a stale reference)", () => {
    const { unmount } = renderStream()

    act(() => {
      current().emit("error")
      vi.advanceTimersByTime(RECONNECT_BASE_MS)
    })
    expect(MockEventSource.instances).toHaveLength(2)
    const replacement = current()

    unmount()
    expect(replacement.closed).toBe(true)
  })

  it("re-subscribes when workspaceId changes and closes the old connection", () => {
    const { rerender } = renderStream("ws-1")
    const first = current()

    rerender({ id: "ws-2" })

    expect(first.closed).toBe(true)
    expect(MockEventSource.instances).toHaveLength(2)
    expect(current().url).toBe("/api/activity/ws-2/stream")
  })
})
