"use client"

// PR-9/pre: extracted from the dashboard page's inline SSE effect to fix a
// reconnect bug: the old `onerror` path constructed a replacement EventSource
// WITHOUT re-attaching any listeners (not even onerror), so after one
// transient disconnect the dashboard silently stopped receiving init/log
// events - and after a second failure it stopped reconnecting entirely -
// while appearing connected. Connection creation and listener attachment are
// now a single `connect()` used by both initial mount and every reconnect.
//
// Reconnect policy: capped exponential backoff (1s, 2s, 4s, … cap 30s) -
// `error` fires in a tight loop when the server is down, and the old code's
// flat 5s timer also stacked unbounded timers across rapid errors. The
// attempt counter resets on a successful `open`.

import { useEffect, useRef } from "react"

export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_CAP_MS = 30_000

export interface ActivityStreamHandlers<T> {
  /** `init` event: the last N rows, oldest→newest (server sends up to 50). */
  onInit: (entries: T[]) => void
  /** `log` event: a single new row. */
  onLog: (entry: T) => void
}

/**
 * Subscribes to `/api/activity/<workspaceId>/stream` for the lifetime of the
 * component (re-subscribes when `workspaceId` changes). Handlers are read
 * through a ref so callers may pass fresh closures every render without
 * tearing down the connection.
 */
export function useActivityStream<T>(workspaceId: string, handlers: ActivityStreamHandlers<T>): void {
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let disposed = false

    // Single source of truth for connection + listener attachment: used by
    // the initial mount AND every reconnect, so a replacement connection can
    // never be missing listeners (the bug this hook exists to fix).
    const connect = () => {
      if (disposed) return
      es = new EventSource(`/api/activity/${workspaceId}/stream`)

      es.addEventListener("open", () => {
        attempt = 0
      })

      es.addEventListener("init", (e) => {
        handlersRef.current.onInit(JSON.parse((e as MessageEvent).data) as T[])
      })

      es.addEventListener("log", (e) => {
        handlersRef.current.onLog(JSON.parse((e as MessageEvent).data) as T)
      })

      es.addEventListener("error", () => {
        es?.close()
        es = null
        if (disposed) return
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_CAP_MS)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      // Close the CURRENT connection (es is reassigned on every reconnect -
      // no stale-ref close) and cancel any pending reconnect so nothing
      // connects after unmount or a workspaceId change.
      disposed = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      es?.close()
      es = null
    }
  }, [workspaceId])
}
