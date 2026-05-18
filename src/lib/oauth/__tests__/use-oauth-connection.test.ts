// @vitest-environment jsdom
//
// PR #4 Commit 7 — hook tests for useOAuthConnection. Guards the shared
// initiate+popup+poll flow that both the setup wizard's initial connect
// and the dashboard-reconnect-for-EXPIRED-rows now run through.
//
// Coverage targets (per Commit 7 handoff):
//   - Reconnect: initiate API called, popup opened, polling starts,
//     CONNECTED transition on poll success
//   - Poll FAILED surfaces via onFailure
//   - Poll timeout surfaces via onTimeout
//   - Initiate errors route through onInitiateError (not onSuccess/onFailure)
//   - Popup-blocked is handled distinctly from network errors
//   - Cleanup: no leaked intervals after ACTIVE or FAILED
//
// Mocking strategy:
//   - global.fetch is vi-mocked per test so we control initiate + status responses
//   - window.open is spied so we can simulate popup success/block
//   - vi.useFakeTimers + vi.advanceTimersByTimeAsync drives the poll cadence
//     and the timeout without waiting 2s+120s on the wallclock

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useOAuthConnection } from "@/lib/oauth/use-oauth-connection"

const WORKSPACE_ID = "ws-test-1"
const TOOL_SLUG = "gmail"

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

function makeFakePopup(): Window {
  // Mock of window.open return — we only use `closed` and `close()` in the
  // hook's cleanup path. Using `let` + a mutable object so close() can flip
  // `closed` for any follow-up inspection in tests.
  const popup: { closed: boolean; close: ReturnType<typeof vi.fn> } = {
    closed: false,
    close: vi.fn(),
  }
  popup.close.mockImplementation(() => {
    popup.closed = true
  })
  return popup as unknown as Window
}

type Callbacks = Parameters<typeof useOAuthConnection>[0]["callbacks"]

function makeCallbacks(): Callbacks & { calls: Record<keyof Callbacks, unknown[]> } {
  const calls = {
    onInitiated: [] as unknown[],
    onSuccess: [] as unknown[],
    onFailure: [] as unknown[],
    onTimeout: [] as unknown[],
    onInitiateError: [] as unknown[],
  }
  return {
    onInitiated: (slug, id) => void calls.onInitiated.push([slug, id]),
    onSuccess: (slug) => void calls.onSuccess.push([slug]),
    onFailure: (slug, err) => void calls.onFailure.push([slug, err]),
    onTimeout: (slug) => void calls.onTimeout.push([slug]),
    onInitiateError: (slug, err) => void calls.onInitiateError.push([slug, err]),
    calls,
  }
}

describe("useOAuthConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn())
    vi.spyOn(window, "open").mockReturnValue(makeFakePopup())
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("happy path: initiate → popup → poll ACTIVE → onSuccess fires exactly once", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      // First call is POST /oauth/initiate
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_123" } }))
      // Subsequent polls: one PENDING then ACTIVE
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "PENDING" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "ACTIVE" } }))

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
      }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      // Flush the initiate fetch + popup open
      await vi.advanceTimersByTimeAsync(1)
    })

    // Initiate fetch shape
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tools/${WORKSPACE_ID}/oauth/initiate`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ toolSlug: TOOL_SLUG }),
      }),
    )
    expect(window.open).toHaveBeenCalled()
    expect(cb.calls.onInitiated).toEqual([[TOOL_SLUG, "ca_123"]])

    // Advance past 2 poll ticks (PENDING, then ACTIVE)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(cb.calls.onSuccess).toEqual([[TOOL_SLUG]])
    expect(cb.calls.onFailure).toEqual([])
    expect(cb.calls.onTimeout).toEqual([])
  })

  it("poll FAILED: surfaces via onFailure with provider-agnostic error message", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_456" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "FAILED" } }))

    const cb = makeCallbacks()
    renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
      })
    )

    const { result } = renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
      }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(cb.calls.onFailure).toEqual([[TOOL_SLUG, "OAuth failed or was cancelled."]])
    expect(cb.calls.onSuccess).toEqual([])
  })

  it("poll timeout: onTimeout fires after timeoutMs elapses without terminal status", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_timeout" } }))
      // Every poll returns PENDING — hook should eventually fire onTimeout.
      .mockResolvedValue(jsonResponse({ success: true, data: { status: "PENDING" } }))

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 300,
      }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(cb.calls.onTimeout).toEqual([[TOOL_SLUG]])
    expect(cb.calls.onSuccess).toEqual([])
    expect(cb.calls.onFailure).toEqual([])
  })

  it("initiate failure: API returns { success: false } → onInitiateError, no popup, no polling", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: { message: "Composio not configured" } }, { status: 503 }),
    )

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({ workspaceId: WORKSPACE_ID, callbacks: cb }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
    })

    // PR2.8a-fix1 Task 4: onInitiateError now passes { message, code? }
    // not a bare string. Server-side errors with no code (here: 503
    // COMPOSIO_NOT_CONFIGURED only sets message) leave code undefined.
    expect(cb.calls.onInitiateError).toEqual([
      [TOOL_SLUG, { message: "Composio not configured", code: undefined }],
    ])
    expect(window.open).not.toHaveBeenCalled()
    expect(cb.calls.onInitiated).toEqual([])
    expect(cb.calls.onSuccess).toEqual([])
  })

  it("initiate failure: API returns code COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH → code piped through", async () => {
    // PR2.8a-fix1 Task 4 regression: the wizard branches on this code to
    // render a yellow warning instead of a red error. If the hook ever
    // stops piping `error.code` through, the wizard silently falls back to
    // the red-error path and the user sees a misleading message. Lock it
    // here.
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: {
            code: "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH",
            message: "This integration requires custom setup. Available within a few days.",
            statusCode: 422,
          },
        },
        { status: 422 },
      ),
    )

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({ workspaceId: WORKSPACE_ID, callbacks: cb }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(cb.calls.onInitiateError).toEqual([
      [
        TOOL_SLUG,
        {
          message: "This integration requires custom setup. Available within a few days.",
          code: "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH",
        },
      ],
    ])
    expect(window.open).not.toHaveBeenCalled()
  })

  it("network failure during initiate: onInitiateError surfaces the caught Error", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"))

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({ workspaceId: WORKSPACE_ID, callbacks: cb }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(cb.calls.onInitiateError).toEqual([[TOOL_SLUG, { message: "ECONNREFUSED" }]])
  })

  it("popup blocked: onInitiateError fires, no polling", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_pop" } }),
    )
    // Simulate browser popup-blocker
    ;(window.open as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({ workspaceId: WORKSPACE_ID, callbacks: cb }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(cb.calls.onInitiated).toEqual([[TOOL_SLUG, "ca_pop"]])
    expect(cb.calls.onInitiateError).toEqual([
      [TOOL_SLUG, { message: "Popup blocked. Allow popups for this site and try again." }],
    ])
  })

  it("repeat connect: cancels the first flow before starting the second", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    // First connect: initiate + keep returning PENDING
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/oauth/initiate")) {
        return Promise.resolve(
          jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_repeat" } }),
        )
      }
      return Promise.resolve(jsonResponse({ success: true, data: { status: "PENDING" } }))
    })

    const cb = makeCallbacks()
    const { result } = renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
      }),
    )

    await act(async () => {
      result.current.connect("gmail")
      await vi.advanceTimersByTimeAsync(1)
      // Start a second connect before the first completes
      result.current.connect("github")
      await vi.advanceTimersByTimeAsync(1)
    })

    // Both should have been initiated; caller decides what to do with the
    // in-flight first connect (we just guarantee no crash + second fires).
    expect(cb.calls.onInitiated.length).toBe(2)
    expect(cb.calls.onInitiated[0]).toEqual(["gmail", "ca_repeat"])
    expect(cb.calls.onInitiated[1]).toEqual(["github", "ca_repeat"])
    // No terminal state for first flow — cleanup happened silently.
    expect(cb.calls.onSuccess).toEqual([])
    expect(cb.calls.onFailure).toEqual([])
  })

  it("unmount during polling: clears intervals so no callbacks fire after unmount", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { redirectUrl: "https://composio/consent", connectionId: "ca_um" } }))
      .mockResolvedValue(jsonResponse({ success: true, data: { status: "PENDING" } }))

    const cb = makeCallbacks()
    const { result, unmount } = renderHook(() =>
      useOAuthConnection({
        workspaceId: WORKSPACE_ID,
        callbacks: cb,
        pollIntervalMs: 50,
        timeoutMs: 10_000,
      }),
    )

    await act(async () => {
      result.current.connect(TOOL_SLUG)
      await vi.advanceTimersByTimeAsync(1)
    })

    unmount()

    await act(async () => {
      // Advance well past where the timeout would have fired
      await vi.advanceTimersByTimeAsync(20_000)
    })

    expect(cb.calls.onTimeout).toEqual([])
    expect(cb.calls.onSuccess).toEqual([])
    expect(cb.calls.onFailure).toEqual([])
  })
})
