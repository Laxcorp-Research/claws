"use client"

// Chat run-state subscription. Primary: the existing activity SSE at
// `/api/activity/<id>/stream?scope=chat-run-state`. Fallback: poll
// `/api/workspaces/<id>/chat/run-state` ONLY when SSE drops or the tab
// was hidden. Polling is never the primary while SSE is live and visible.
//
// Init is MERGED by id (never wholesale-replaced). That is the reload bug:
// the dashboard stream's onInit replaces its 50-row mixed buffer and the
// chat panel previously had no buffer of its own.

import { useEffect, useRef, useState } from "react"
import {
  chatRunStateStreamUrl,
  isChatRunStateEntry,
  mergeChatRunStateRows,
  type ChatRunStateEntry,
} from "@/lib/chat/run-state"

export const CHAT_RUN_STATE_RECONNECT_BASE_MS = 1_000
export const CHAT_RUN_STATE_RECONNECT_CAP_MS = 30_000
export const CHAT_RUN_STATE_FALLBACK_BASE_MS = 1_000
export const CHAT_RUN_STATE_FALLBACK_CAP_MS = 8_000

export interface ChatRunStateSnapshot {
  rows: ChatRunStateEntry[]
  live: boolean
}

function parseEntries(raw: string): ChatRunStateEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.filter(isChatRunStateRecord)
    if (parsed && typeof parsed === "object") {
      const one = parsed as ChatRunStateEntry
      return isChatRunStateRecord(one) ? [one] : []
    }
  } catch {
    // malformed SSE payload - ignore
  }
  return []
}

function isChatRunStateRecord(value: unknown): value is ChatRunStateEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as ChatRunStateEntry
  return typeof entry.id === "string" && typeof entry.actionType === "string" && isChatRunStateEntry(entry)
}

export function useChatRunState(
  workspaceId: string,
  pendingRunIds: readonly string[],
): ChatRunStateSnapshot {
  const [rows, setRows] = useState<ChatRunStateEntry[]>([])
  const [live, setLive] = useState(false)
  const [fallback, setFallback] = useState(false)
  const pendingRef = useRef(pendingRunIds)
  pendingRef.current = pendingRunIds
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const mergeIncoming = (incoming: ChatRunStateEntry[]) => {
    const kept = incoming.filter(isChatRunStateEntry)
    if (kept.length === 0) return
    setRows((prev) => mergeChatRunStateRows(prev, kept))
  }

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setFallback(true)
      setLive(false)
      return
    }

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let disposed = false

    const connect = () => {
      if (disposed) return
      // MUTATION: remove this EventSource (or drop the scope query) →
      // use-chat-run-state.test + e2e/chat-run-state.spec fail.
      es = new EventSource(chatRunStateStreamUrl(workspaceId))

      es.addEventListener("open", () => {
        attempt = 0
        setLive(true)
        setFallback(false)
      })

      es.addEventListener("init", (e) => {
        mergeIncoming(parseEntries((e as MessageEvent).data as string))
      })

      es.addEventListener("log", (e) => {
        mergeIncoming(parseEntries((e as MessageEvent).data as string))
      })

      es.addEventListener("error", () => {
        setLive(false)
        setFallback(true)
        es?.close()
        es = null
        if (disposed) return
        const delay = Math.min(CHAT_RUN_STATE_RECONNECT_BASE_MS * 2 ** attempt, CHAT_RUN_STATE_RECONNECT_CAP_MS)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      es?.close()
      es = null
    }
  }, [workspaceId])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setFallback(true)
        return
      }
      void pollRunState(workspaceId, pendingRef.current, rowsRef.current, mergeIncoming)
      if (live) setFallback(false)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [workspaceId, live])

  useEffect(() => {
    // Primary path is SSE. Poll only when fallback is armed AND a turn is
    // in flight (or we already have rows to catch up from).
    if (!fallback) return
    if (pendingRunIds.length === 0 && rows.length === 0) return
    if (live && typeof document !== "undefined" && document.visibilityState === "visible") {
      return
    }

    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      await pollRunState(workspaceId, pendingRef.current, rowsRef.current, mergeIncoming)
      const delay = Math.min(CHAT_RUN_STATE_FALLBACK_BASE_MS * 2 ** attempt, CHAT_RUN_STATE_FALLBACK_CAP_MS)
      attempt += 1
      timer = setTimeout(() => {
        void tick()
      }, delay)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [fallback, live, pendingRunIds, rows.length, workspaceId])

  return { rows, live }
}

export async function pollRunState(
  workspaceId: string,
  pendingRunIds: readonly string[],
  current: readonly ChatRunStateEntry[],
  mergeIncoming: (incoming: ChatRunStateEntry[]) => void,
): Promise<void> {
  const params = new URLSearchParams()
  if (pendingRunIds.length > 0) params.set("runIds", pendingRunIds.join(","))
  const newest = current.length > 0 ? current[current.length - 1]?.timestamp : null
  if (newest) params.set("since", newest)
  const qs = params.toString()
  const url = `/api/workspaces/${workspaceId}/chat/run-state${qs ? `?${qs}` : ""}`
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const json = (await res.json()) as { success?: boolean; data?: { rows?: ChatRunStateEntry[] } }
    if (!json.success || !Array.isArray(json.data?.rows)) return
    mergeIncoming(json.data.rows)
  } catch {
    // fallback miss - next backoff tick retries
  }
}
