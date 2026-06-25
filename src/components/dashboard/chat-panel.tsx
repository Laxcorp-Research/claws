"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage, type ChatBubbleStatus } from "./chat-message"

// Mirror of the send endpoint cap (src/app/api/workspaces/[id]/chat/route.ts
// MESSAGE_MAX_CHARS) so the composer can't compose something the server will
// 400 on.
const MESSAGE_MAX_CHARS = 4000

// PR-9/B: chat is only sendable on a contactable Claw. RUNNING is the happy
// path; ERROR is attempted as a recovery path (the send endpoint maps the
// failure honestly). Every other status disables the composer here and the
// endpoint would 409/502 anyway. Rich per-state copy is 9/C.
const SENDABLE_STATUSES: ReadonlySet<string> = new Set(["RUNNING", "ERROR"])

// A webchat MESSAGE_* row projected from the dashboard's existing activity
// stream (LogEntry). The page filters to channelId === "webchat" before
// passing rows in, so MESSAGE_RECEIVED == the user and MESSAGE_SENT == the
// agent reply.
export interface ChatRow {
  id: string
  actionType: string
  timestamp: string
  agentName: string
  action: string
  detail?: string | null
  // MESSAGE_RECEIVED carries the turn key here (=== the 202 runId).
  messageId?: string | null
  // MESSAGE_SENT (the agent reply) carries the turn key here (=== the same
  // 202 runId). Projected by formatLog so the working indicator can pair a
  // reply to its send per-turn.
  runId?: string | null
}

// A message the composer rendered optimistically. The send endpoint writes NO
// ActivityLog row; the canonical MESSAGE_RECEIVED arrives on SSE ~10s later
// (container reporter flush) with metadata.messageId === the runId we got back
// from the 202. Until then this is the only record of the user's message.
export interface OptimisticMessage {
  tempId: string
  text: string
  createdAt: number
  status: ChatBubbleStatus
  runId?: string
}

export interface ChatMessageView {
  key: string
  sender: "user" | "agent"
  senderName: string
  sortTs: number
  detail: string | null
  action: string
  status?: ChatBubbleStatus
  // The turn-correlation key (=== the 202 runId). For a user view it's the
  // optimistic send's runId or the streamed MESSAGE_RECEIVED.messageId; for an
  // agent view it's the streamed MESSAGE_SENT.runId. Drives per-turn pending.
  runId?: string | null
}

/**
 * PR-9/B reconciliation (pure; unit-tested in chat-panel.test.tsx).
 *
 * Merges the composer's optimistic messages with the streamed webchat
 * MESSAGE_* rows into a single time-ordered list. The load-bearing rule:
 *
 *   An optimistic message whose `runId` matches a streamed
 *   MESSAGE_RECEIVED.messageId is DROPPED — the streamed row replaces it.
 *
 * Because runId (from the 202) === the container's metadata.messageId, this is
 * the dedupe that stops the user's own message rendering twice (once optimistic,
 * once from the stream). Remove the filter and every reconciled message
 * double-renders — locked by the dedupe test.
 */
export function reconcileChatMessages(
  optimistic: OptimisticMessage[],
  rows: ChatRow[],
  orchestratorName: string,
): ChatMessageView[] {
  const reconciledRunIds = new Set(
    rows
      .filter(
        (r) =>
          r.actionType === "MESSAGE_RECEIVED" &&
          typeof r.messageId === "string" &&
          r.messageId.length > 0,
      )
      .map((r) => r.messageId as string),
  )

  const views: ChatMessageView[] = []

  for (const o of optimistic) {
    // Reconciled → the streamed MESSAGE_RECEIVED below renders instead.
    if (o.runId && reconciledRunIds.has(o.runId)) continue
    views.push({
      key: o.tempId,
      sender: "user",
      senderName: "You",
      sortTs: o.createdAt,
      detail: o.text,
      action: o.text,
      status: o.status,
      runId: o.runId ?? null,
    })
  }

  for (const r of rows) {
    const isUser = r.actionType === "MESSAGE_RECEIVED"
    const parsed = Date.parse(r.timestamp)
    views.push({
      key: r.id,
      sender: isUser ? "user" : "agent",
      // Clean sender name: the user is always "You"; the agent reply uses its
      // resolved display name (or the orchestrator's name as a fallback).
      senderName: isUser ? "You" : r.agentName || orchestratorName || "Agent",
      sortTs: Number.isNaN(parsed) ? 0 : parsed,
      detail: r.detail ?? null,
      action: r.action,
      // The turn key lives in different metadata fields per row type: a user
      // send (MESSAGE_RECEIVED) carries it as messageId; the agent reply
      // (MESSAGE_SENT) carries it as runId. Normalize both into `runId` so
      // pending-matching pairs them by a single value.
      runId: isUser ? r.messageId ?? null : r.runId ?? null,
    })
  }

  views.sort((a, b) => a.sortTs - b.sortTs)
  return views
}

// A turn that gets no reply must NOT spin "working…" forever. Turns finish in
// ~10s; 2 min is a very generous ceiling after which an unreplied turn is
// declared "no response" (stale container, hung turn, dropped reply). Named so
// the timeout is auditable, not a magic number.
export const PENDING_TURN_TIMEOUT_MS = 2 * 60 * 1000

// How often the panel re-evaluates time-bounded pending state WITHOUT a new
// message — long enough to be cheap, short enough that "no response" appears
// promptly after the 2-min ceiling. The interval runs ONLY while a turn is
// pending (see the effect in ChatPanel) — never on a quiet panel.
export const PENDING_TICK_MS = 15 * 1000

export type TurnState = "pending" | "no_response"

// WORKING-INDICATOR FIX (replaces the old count-based isAgentWorking).
//
// The old logic was `(started user turns) − (agent replies) > 0`. It assumed
// every user turn eventually yields a MESSAGE_SENT; a single orphaned turn (an
// old "hello" to a stale container that never emitted a reply) permanently made
// started > replied → the indicator stuck ON forever, even after later turns
// replied. Count-based cannot recover from an unreplied turn.
//
// This is PER-TURN, keyed by runId, and TIME-BOUNDED. For each user turn (an
// optimistic send or a streamed MESSAGE_RECEIVED) that carries a runId and
// actually started a run (status not "sending"/"failed"):
//   - replied   → a MESSAGE_SENT with the SAME runId exists → not tracked.
//   - pending   → no reply yet AND within PENDING_TURN_TIMEOUT_MS of turn start.
//   - no_response → no reply AND past the timeout (stops the spinner; the bubble
//                   gets a quiet "No response" note — distinct from a send
//                   failure, because the send SUCCEEDED).
// Because it's per-runId and time-bounded: a later replied turn resolves on its
// own, and an earlier orphan ages out instead of holding the indicator hostage.
export function computeTurnStatuses(
  views: ChatMessageView[],
  now: number,
  timeoutMs: number = PENDING_TURN_TIMEOUT_MS,
): Map<string, TurnState> {
  const repliedRunIds = new Set<string>()
  for (const v of views) {
    if (v.sender === "agent" && typeof v.runId === "string" && v.runId.length > 0) {
      repliedRunIds.add(v.runId)
    }
  }

  const statuses = new Map<string, TurnState>()
  for (const v of views) {
    if (v.sender !== "user") continue
    // No run started yet (pre-202) or the send failed (no run will start) →
    // not a pending turn; the bubble's own "Sending…"/"Failed to send" covers it.
    if (v.status === "sending" || v.status === "failed") continue
    // Need the turn key to correlate a reply; a keyless user row can't be paired.
    if (typeof v.runId !== "string" || v.runId.length === 0) continue
    // The reply already arrived → resolved, nothing to show.
    if (repliedRunIds.has(v.runId)) continue
    statuses.set(v.runId, now - v.sortTs < timeoutMs ? "pending" : "no_response")
  }
  return statuses
}

// The agent owes a reply iff at least one turn is genuinely pending (unreplied
// AND within the timeout). Drives the working indicator.
export function hasPendingTurn(statuses: Map<string, TurnState>): boolean {
  for (const s of statuses.values()) {
    if (s === "pending") return true
  }
  return false
}

// PR-9/B polish (GAP #3): is the scroll container within `threshold`px of the
// bottom? Drives the "only auto-scroll if already near the bottom" guard so a
// late reply never yanks a user who scrolled up to read history.
export function isNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 80,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

function WorkingIndicator({ orchestratorName }: { orchestratorName: string }) {
  const name = orchestratorName || "Orchestrator"
  return (
    <div className="flex flex-col gap-[3px] max-w-[85%] self-start items-start">
      <div className="flex items-center gap-1.5 text-[10px] leading-none">
        <span className="font-semibold text-[var(--tx2)]">{name}</span>
      </div>
      <div
        role="status"
        className="rounded-lg px-3 py-2 bg-[var(--bg2)] border border-[var(--bd)] inline-flex items-center gap-1"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--tx3)] animate-bounce [animation-delay:-0.3s]" aria-hidden="true" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--tx3)] animate-bounce [animation-delay:-0.15s]" aria-hidden="true" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--tx3)] animate-bounce" aria-hidden="true" />
        <span className="sr-only">{name} is working…</span>
      </div>
    </div>
  )
}

function makeTempId(): string {
  const rnd =
    typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `tmp_${rnd}`
}

function formatClock(ms: number): string {
  // UTC to match the activity feed's tz convention (operators cross-correlate
  // with Railway/CI logs; see the dashboard page's formatTime note).
  const hms = new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })
  return `${hms} UTC`
}

interface ChatPanelProps {
  workspaceId: string
  status: string
  rows: ChatRow[]
  orchestratorName: string
}

export function ChatPanel({ workspaceId, status, rows, orchestratorName }: ChatPanelProps) {
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [draft, setDraft] = useState("")
  // GAP #3: ref to the SCROLL CONTAINER (not a sentinel) so we move only this
  // element's scrollTop — never the page viewport (scrollIntoView moved all
  // scrollable ancestors and jumped the whole dashboard).
  const listRef = useRef<HTMLDivElement | null>(null)
  // Start pinned; recomputed on every user scroll. When the user scrolls up to
  // read history this goes false and new messages stop yanking them down.
  const nearBottomRef = useRef(true)

  const sendable = SENDABLE_STATUSES.has(status)

  const messages = useMemo(
    () => reconcileChatMessages(optimistic, rows, orchestratorName),
    [optimistic, rows, orchestratorName],
  )

  // Re-eval clock for time-bounded pending. Advanced ONLY by the tick effect
  // below while a turn is pending — a quiet panel never touches it (no idle
  // timer). Initialised lazily so SSR/first paint is stable.
  const [nowTick, setNowTick] = useState(() => Date.now())

  // Per-turn pending state: runId-keyed + time-bounded (see computeTurnStatuses).
  const turnStatuses = useMemo(() => computeTurnStatuses(messages, nowTick), [messages, nowTick])

  // GAP #2 (fixed): the agent is "working" only while a turn is GENUINELY
  // pending — unreplied AND within PENDING_TURN_TIMEOUT_MS. Gated to a sendable
  // Claw. Per-turn + time-bounded means an orphaned turn ages out to
  // "No response" instead of sticking the indicator on forever.
  const pending = hasPendingTurn(turnStatuses)
  const working = sendable && pending

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (el) nearBottomRef.current = isNearBottom(el)
  }, [])

  // Pin to newest ONLY when the user is already near the bottom. Scrolls the
  // container directly (no scrollIntoView → no page jump). Re-runs when a
  // message lands or the working indicator toggles.
  useEffect(() => {
    const el = listRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, working])

  // GAP #2 timeout tick: advance the clock WITHOUT a new message so a turn that
  // never replies flips from "working…" to "No response" once it crosses
  // PENDING_TURN_TIMEOUT_MS. START-ON-PENDING / STOP-ON-EMPTY: the interval is
  // created only while a turn is pending and torn down the instant none is (the
  // crossing turn recomputes `pending` → false → cleanup runs). No idle interval
  // on a quiet panel; cleared on unmount → no leak. (When a turn stays pending
  // across ticks, `pending` is unchanged so the same interval persists — it does
  // not churn a new timer each tick.)
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setNowTick(Date.now()), PENDING_TICK_MS)
    return () => clearInterval(id)
  }, [pending])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sendable) return

    const tempId = makeTempId()
    const createdAt = Date.now()
    setOptimistic((prev) => [...prev, { tempId, text, createdAt, status: "sending" }])
    setDraft("")

    const mark = (patch: Partial<OptimisticMessage>) =>
      setOptimistic((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, ...patch } : m)))

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      })
      if (res.status === 202) {
        // Store runId so the optimistic bubble reconciles against the streamed
        // MESSAGE_RECEIVED (messageId === runId).
        const json = (await res.json().catch(() => null)) as { data?: { runId?: string } } | null
        mark({ status: "sent", runId: json?.data?.runId })
      } else {
        // 409 (hibernated/stopped/transitioning) / 502 (gateway) / 429 (rate)
        // / 4xx — mark failed, NEVER throw. 9/B tolerates these; rich per-code
        // copy + retry is 9/C.
        mark({ status: "failed" })
      }
    } catch {
      // Network error — same honest "failed" bubble, no throw.
      mark({ status: "failed" })
    }
  }, [draft, sendable, workspaceId])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <section aria-label="Chat" className="border border-[var(--bd)] rounded-lg mb-6">
      <div className="px-3.5 py-2.5 border-b border-[var(--bd)]">
        <h2 className="text-[12px] font-semibold text-[var(--tx)]">Chat</h2>
        <p className="text-[11px] text-[var(--tx3)] mt-0.5">
          Message {orchestratorName || "your orchestrator"} directly.
        </p>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex flex-col gap-3 p-3.5 min-h-[120px] max-h-[360px] overflow-y-auto"
        role="log"
        aria-label="Chat messages"
      >
        {messages.length === 0 && !working ? (
          <p className="text-[11px] text-[var(--tx3)] py-6 text-center">
            No messages yet. Say hello to get started.
          </p>
        ) : (
          messages.map((m) => {
            // A user turn whose runId aged out with no reply → quiet "No
            // response" note (distinct from a send failure: the send succeeded).
            const noResponse =
              m.sender === "user" &&
              typeof m.runId === "string" &&
              turnStatuses.get(m.runId) === "no_response"
            return (
              <ChatMessage
                key={m.key}
                sender={m.sender}
                senderName={m.senderName}
                timestamp={formatClock(m.sortTs)}
                detail={m.detail}
                action={m.action}
                status={m.status}
                noResponse={noResponse}
              />
            )
          })
        )}
        {working && <WorkingIndicator orchestratorName={orchestratorName} />}
      </div>

      <div className="border-t border-[var(--bd)] p-3.5">
        {!sendable && (
          <p className="text-[11px] text-[var(--tx3)] mb-2">
            Chat is unavailable while your Claw is {status.toLowerCase()}.
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={sendable ? "Type a message…" : "Chat unavailable"}
            disabled={!sendable}
            maxLength={MESSAGE_MAX_CHARS}
            rows={2}
            aria-label="Message"
            className="flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void send()}
            disabled={!sendable || draft.trim().length === 0}
          >
            Send
          </Button>
        </div>
      </div>
    </section>
  )
}
