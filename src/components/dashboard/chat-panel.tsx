"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage, type ChatBubbleStatus } from "./chat-message"
import { cn } from "@/lib/utils"
import {
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

// Mirror of the send endpoint cap (src/app/api/workspaces/[id]/chat/route.ts
// MESSAGE_MAX_CHARS) so the composer can't compose something the server will
// 400 on.
const MESSAGE_MAX_CHARS = 4000

// PR-9/B: chat is only sendable on a contactable Claw. RUNNING is the happy
// path; ERROR is attempted as a recovery path (the send endpoint maps the
// failure honestly). Every other status disables the composer here and the
// endpoint would 409/502 anyway.
const SENDABLE_STATUSES: ReadonlySet<string> = new Set(["RUNNING", "ERROR"])

// PR-9/C: rich per-state UX. Two surfaces resolve to ONE of these reasons so
// they show the SAME words: (1) the disabled composer (pre-send, from the
// workspace status) and (2) a failed send bubble (the mid-compose race - a
// RUNNING Claw that changed state between compose and send returns a 409/502,
// surfaced from error.code). `cta` is the affordance the surface MAY offer:
// "wake" (HIBERNATED - needs the page's onWake) or "retry" (transient - re-POST
// the same text without retyping).
export type ChatUnavailableReason =
  | "asleep" // HIBERNATED / WORKSPACE_HIBERNATED
  | "waking" // WAKING
  | "deploying" // DEPLOYING
  | "paused" // PAUSED (defensive - no writer today, §audit)
  | "stopped" // WORKSPACE_STOPPED (send-time race; panel is hidden pre-send)
  | "queued" // PROVISIONING_QUEUED
  | "transitioning" // WORKSPACE_TRANSITIONING (send-time; status ambiguous)
  | "unreachable" // GATEWAY_UNREACHABLE (RUNNING but container down)
  | "rate_limited" // RATE_LIMITED (429)
  | "unknown" // network error / unmapped - the legacy "Failed to send"

export interface ChatUnavailableCopy {
  message: string
  cta?: "wake" | "retry"
}

const REASON_COPY: Record<ChatUnavailableReason, ChatUnavailableCopy> = {
  asleep: { message: "Your Claw is asleep - wake it to chat.", cta: "wake" },
  waking: { message: "Starting up - chat unlocks automatically." },
  deploying: { message: "Deploying - chat unlocks when it's live." },
  queued: { message: "High demand - your claw is queued to provision." },
  paused: { message: "Chat is paused." },
  stopped: { message: "This Claw is stopped - redeploy it to chat." },
  transitioning: { message: "Your Claw is starting up - try again shortly.", cta: "retry" },
  unreachable: { message: "Can't reach your Claw.", cta: "retry" },
  rate_limited: { message: "Too many messages - wait a moment, then retry.", cta: "retry" },
  unknown: { message: "Failed to send", cta: "retry" },
}

export function chatUnavailableCopy(reason: ChatUnavailableReason): ChatUnavailableCopy {
  return REASON_COPY[reason]
}

// Pre-send: workspace status → reason. Only the non-sendable states that
// actually render reach the composer (RUNNING/ERROR are sendable; DRAFT/
// SETUP_INCOMPLETE/STOPPED are hidden by the dashboard isEmpty gate). STOPPED is
// mapped anyway so the send-time path can reuse the same copy.
export function statusToReason(status: string): ChatUnavailableReason {
  switch (status) {
    case "HIBERNATED":
      return "asleep"
    case "WAKING":
      return "waking"
    case "DEPLOYING":
      return "deploying"
    case "PROVISIONING_QUEUED":
      return "queued"
    case "PAUSED":
      return "paused"
    case "STOPPED":
      return "stopped"
    default:
      return "unknown"
  }
}

// Send-time: the 409/502 error.code → the SAME reason set, so a state change
// mid-compose shows the same words as the pre-send panel. No/unmapped code (a
// network error) → "unknown" (the legacy generic copy).
export function errorCodeToReason(code: string | null | undefined): ChatUnavailableReason {
  switch (code) {
    case "WORKSPACE_HIBERNATED":
      return "asleep"
    case "WORKSPACE_STOPPED":
      return "stopped"
    case "WORKSPACE_TRANSITIONING":
      return "transitioning"
    case "GATEWAY_UNREACHABLE":
      return "unreachable"
    case "RATE_LIMITED":
      return "rate_limited"
    default:
      return "unknown"
  }
}

// A webchat MESSAGE_* row projected from the dashboard's existing activity
// stream (LogEntry). The page filters to channelId === "webchat" before
// passing rows in, so MESSAGE_RECEIVED == the user and MESSAGE_SENT == the
// agent reply.
export interface ChatRow {
  id: string
  actionType: string
  timestamp: string
  agentName: string
  agentSlug?: string | null
  action: string
  detail?: string | null
  apiCost?: number | null
  // MESSAGE_RECEIVED carries the turn key here (=== the 202 runId).
  messageId?: string | null
  channelId?: string | null
  from?: string | null
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
  // PR-9/C: the non-202 error.code captured when a send fails (e.g.
  // "WORKSPACE_HIBERNATED"), so the failed bubble can show the matching
  // per-state copy. Undefined for a network error (→ the "unknown" reason).
  failureCode?: string
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
  // PR-9/C: only on a failed optimistic send - the non-202 error.code, used to
  // pick the failed bubble's tailored copy. Streamed rows never carry it.
  failureCode?: string
}

function chatRowBody(row: ChatRow): string {
  return row.detail && row.detail.length > 0 ? row.detail : row.action
}

function isNoReplyText(value: string | null | undefined): boolean {
  return isProtocolOnlyChatBody(value)
}

/**
 * PR-9/B reconciliation (pure; unit-tested in chat-panel.test.tsx).
 *
 * Merges the composer's optimistic messages with the streamed webchat
 * MESSAGE_* rows into a single time-ordered list. The load-bearing rule:
 *
 *   An optimistic message whose `runId` matches a streamed
 *   MESSAGE_RECEIVED.messageId is DROPPED - the streamed row replaces it.
 *
 * Because runId (from the 202) === the container's metadata.messageId, this is
 * the dedupe that stops the user's own message rendering twice (once optimistic,
 * once from the stream). Remove the filter and every reconciled message
 * double-renders - locked by the dedupe test.
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
      failureCode: o.failureCode,
    })
  }

  for (const r of rows) {
    const isUser = r.actionType === "MESSAGE_RECEIVED"
    if (!isUser && isNoReplyText(chatRowBody(r))) continue
    const parsed = Date.parse(r.timestamp)
    views.push({
      key: r.id,
      sender: isUser ? "user" : "agent",
      // Clean sender name: the user is always "You"; the agent reply uses its
      // resolved display name (or the orchestrator's name as a fallback).
      senderName: isUser ? "You" : r.agentName || orchestratorName || "Agent",
      sortTs: Number.isNaN(parsed) ? 0 : parsed,
      detail: r.detail != null ? stripPlatformSentinels(r.detail) : null,
      action: stripPlatformSentinels(r.action),
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

// History endpoint rows and SSE rows are the SAME persisted ActivityLog rows.
// Dedupe persisted sources by DB id before optimistic reconciliation; otherwise
// a recently loaded history page and an SSE event for the same row double-render.
export function mergePersistedChatRows(historyRows: ChatRow[], liveRows: ChatRow[]): ChatRow[] {
  const byId = new Map<string, ChatRow>()
  for (const row of historyRows) byId.set(row.id, row)
  for (const row of liveRows) byId.set(row.id, row)
  return Array.from(byId.values()).sort((a, b) => {
    const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp)
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })
}

// A turn that gets no reply must NOT spin "working…" forever. Turns finish in
// ~10s; 2 min is a very generous ceiling after which an unreplied turn is
// declared "no response" (stale container, hung turn, dropped reply). Named so
// the timeout is auditable, not a magic number.
export const PENDING_TURN_TIMEOUT_MS = 2 * 60 * 1000

// How often the panel re-evaluates time-bounded pending state WITHOUT a new
// message - long enough to be cheap, short enough that "no response" appears
// promptly after the 2-min ceiling. The interval runs ONLY while a turn is
// pending (see the effect in ChatPanel) - never on a quiet panel.
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
//                   gets a quiet "No response" note - distinct from a send
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

export function preservePrependedScrollPosition(
  el: { scrollHeight: number; scrollTop: number },
  previous: { scrollHeight: number; scrollTop: number },
): void {
  el.scrollTop = previous.scrollTop + (el.scrollHeight - previous.scrollHeight)
}

// Remaining viewport under the pane's document offset. Used so fullHeight
// cannot overshoot when chrome (command strip + health line + tabs) is taller
// than the 260px CSS fallback. Document-relative (rect.top + scrollY) so a
// mid-page scroll does not enlarge the pane and create empty space below.
export const CHAT_PANE_MIN_PX = 240
export const CHAT_PANE_BOTTOM_GAP_PX = 24

export function chatPaneMaxHeightPx(args: {
  paneOffsetTop: number
  viewportHeight: number
  bottomGap?: number
}): number {
  const gap = args.bottomGap ?? CHAT_PANE_BOTTOM_GAP_PX
  return Math.max(CHAT_PANE_MIN_PX, Math.floor(args.viewportHeight - args.paneOffsetTop - gap))
}

// Composer grow: start at 2 lines, grow through 6 visible lines, then freeze
// and scroll inside. Measure with height=0 and maxHeight=none so a CSS max-h
// (or rows=2) cannot freeze scrollHeight at the visible box.
export const COMPOSER_LINE_PX = 16
export const COMPOSER_PAD_Y_PX = 16
export const COMPOSER_MIN_ROWS = 2
export const COMPOSER_MAX_ROWS = 6
export const COMPOSER_MIN_HEIGHT_PX = COMPOSER_PAD_Y_PX + COMPOSER_LINE_PX * COMPOSER_MIN_ROWS
export const COMPOSER_MAX_HEIGHT_PX = COMPOSER_PAD_Y_PX + COMPOSER_LINE_PX * COMPOSER_MAX_ROWS

export function composerLineBox(style: {
  lineHeight: string
  paddingTop: string
  paddingBottom: string
}): { minH: number; maxH: number } {
  const parsedLine = parseFloat(style.lineHeight)
  const line = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : COMPOSER_LINE_PX
  const pad =
    (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) || COMPOSER_PAD_Y_PX
  return {
    minH: pad + line * COMPOSER_MIN_ROWS,
    maxH: pad + line * COMPOSER_MAX_ROWS,
  }
}

export function fitChatComposer(el: HTMLTextAreaElement): { height: number; overflowY: "hidden" | "auto" } {
  const box = composerLineBox(getComputedStyle(el))
  const prevMax = el.style.maxHeight
  el.style.maxHeight = "none"
  el.style.height = "0px"
  el.style.overflowY = "hidden"
  const raw = el.scrollHeight
  const height = Math.min(box.maxH, Math.max(box.minH, raw))
  el.style.height = `${height}px`
  el.style.maxHeight = prevMax
  el.style.overflowY = raw > box.maxH ? "auto" : "hidden"
  return { height, overflowY: raw > box.maxH ? "auto" : "hidden" }
}

function WorkingIndicator({ orchestratorName }: { orchestratorName: string }) {
  const name = orchestratorName || "Orchestrator"
  // Opacity pulse only - translateY bounce expands the nearest scrollport
  // (often the page) and paints empty space below the composer. Overflow is
  // clipped and overflow-anchor is off so inserting this row cannot grow or
  // re-anchor the document. Live-status lives in the already-visible header
  // (role=status here made Chrome scroll this node into view).
  return (
    <div
      data-working-indicator
      className="flex max-w-[85%] min-w-0 flex-col items-start gap-[3px] self-start [overflow-anchor:none]"
    >
      <div className="flex items-center gap-1.5 text-[10px] leading-none">
        <span className="font-semibold text-[var(--tx2)]">{name}</span>
      </div>
      <div className="inline-flex items-center gap-1 overflow-hidden rounded-lg border border-[var(--bd)] bg-[var(--bg2)] px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--tx3)] animate-pulse [animation-delay:-0.3s]" aria-hidden="true" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--tx3)] animate-pulse [animation-delay:-0.15s]" aria-hidden="true" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--tx3)] animate-pulse" aria-hidden="true" />
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

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

interface ChatPanelProps {
  workspaceId: string
  status: string
  rows: ChatRow[]
  orchestratorName: string
  // PR-9/C: wakes a HIBERNATED Claw - wired from the dashboard page to its
  // existing wake action (POST /api/dashboard/[id]/wake). Optional so the panel
  // degrades to copy-only if a caller doesn't provide it.
  onWake?: () => void
  historyEnabled?: boolean
  historyPageSize?: number
  fullHeight?: boolean
  className?: string
}

interface ChatHistoryResponse {
  rows: ChatRow[]
  nextCursor: string | null
}

export function ChatPanel({
  workspaceId,
  status,
  rows,
  orchestratorName,
  onWake,
  historyEnabled = false,
  historyPageSize = 30,
  fullHeight = false,
  className,
}: ChatPanelProps) {
  const [historyRows, setHistoryRows] = useState<ChatRow[]>([])
  const [nextHistoryCursor, setNextHistoryCursor] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [draft, setDraft] = useState("")
  // GAP #3: ref to the SCROLL CONTAINER (not a sentinel) so we move only this
  // element's scrollTop - never the page viewport (scrollIntoView moved all
  // scrollable ancestors and jumped the whole dashboard).
  const listRef = useRef<HTMLDivElement | null>(null)
  const paneRef = useRef<HTMLElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [paneMaxPx, setPaneMaxPx] = useState<number | undefined>(undefined)
  // Start pinned; recomputed on every user scroll. When the user scrolls up to
  // read history this goes false and new messages stop yanking them down.
  const nearBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const sendable = SENDABLE_STATUSES.has(status)

  // PR-9/C: tailored disabled-composer copy + (HIBERNATED only) an inline Wake
  // CTA. An unmapped non-sendable status falls back to the legacy templated note
  // rather than the "Failed to send" wording, which would be wrong here.
  const unavailableReason = statusToReason(status)
  const unavailableCopy = chatUnavailableCopy(unavailableReason)
  const composerNote =
    unavailableReason === "unknown"
      ? `Chat is unavailable while your Claw is ${status.toLowerCase()}.`
      : unavailableCopy.message
  const showWake = unavailableCopy.cta === "wake" && !!onWake

  const persistedRows = useMemo(
    () => mergePersistedChatRows(historyRows, rows),
    [historyRows, rows],
  )

  const messages = useMemo(
    () => reconcileChatMessages(optimistic, persistedRows, orchestratorName),
    [optimistic, persistedRows, orchestratorName],
  )

  // Re-eval clock for time-bounded pending. Advanced ONLY by the tick effect
  // below while a turn is pending - a quiet panel never touches it (no idle
  // timer). Initialised lazily so SSR/first paint is stable.
  const [nowTick, setNowTick] = useState(() => Date.now())

  // Per-turn pending state: runId-keyed + time-bounded (see computeTurnStatuses).
  const turnStatuses = useMemo(() => computeTurnStatuses(messages, nowTick), [messages, nowTick])

  // GAP #2 (fixed): the agent is "working" only while a turn is GENUINELY
  // pending - unreplied AND within PENDING_TURN_TIMEOUT_MS. Gated to a sendable
  // Claw. Per-turn + time-bounded means an orphaned turn ages out to
  // "No response" instead of sticking the indicator on forever.
  const pending = hasPendingTurn(turnStatuses)
  const working = sendable && pending
  const prependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)

  useEffect(() => {
    if (!historyEnabled) {
      setHistoryRows([])
      setNextHistoryCursor(null)
      setHistoryLoading(false)
      return
    }
    let cancelled = false
    setHistoryRows([])
    setNextHistoryCursor(null)
    setHistoryLoading(true)
    fetch(`/api/workspaces/${workspaceId}/chat/history?limit=${historyPageSize}`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: ChatHistoryResponse }) => {
        if (cancelled || !json.success || !json.data) return
        setHistoryRows(json.data.rows)
        setNextHistoryCursor(json.data.nextCursor)
      })
      .catch(() => {
        // If history fails, live SSE rows still keep chat usable.
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [historyEnabled, historyPageSize, workspaceId])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (el) {
      nearBottomRef.current = isNearBottom(el)
      setShowJump(!nearBottomRef.current)
    }
  }, [])

  // Pin to newest ONLY when the user is already near the bottom. Scrolls the
  // container directly (no scrollIntoView → no page jump). Re-runs when a
  // message lands or the working indicator toggles.
  useEffect(() => {
    const el = listRef.current
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setShowJump(false)
    } else if (el) {
      setShowJump(true)
    }
  }, [messages.length, working])

  useLayoutEffect(() => {
    const previous = prependScrollRef.current
    const el = listRef.current
    if (!previous || !el) return
    preservePrependedScrollPosition(el, previous)
    prependScrollRef.current = null
  }, [messages.length])

  useLayoutEffect(() => {
    if (!fullHeight) {
      setPaneMaxPx(undefined)
      return
    }
    const pane = paneRef.current
    if (!pane) return
    const apply = () => {
      const top = pane.getBoundingClientRect().top + window.scrollY
      setPaneMaxPx(chatPaneMaxHeightPx({ paneOffsetTop: top, viewportHeight: window.innerHeight }))
    }
    apply()
    window.addEventListener("resize", apply)
    return () => window.removeEventListener("resize", apply)
  }, [fullHeight])

  useLayoutEffect(() => {
    const el = composerRef.current
    if (el) fitChatComposer(el)
  }, [draft])

  // GAP #2 timeout tick: advance the clock WITHOUT a new message so a turn that
  // never replies flips from "working…" to "No response" once it crosses
  // PENDING_TURN_TIMEOUT_MS. START-ON-PENDING / STOP-ON-EMPTY: the interval is
  // created only while a turn is pending and torn down the instant none is (the
  // crossing turn recomputes `pending` → false → cleanup runs). No idle interval
  // on a quiet panel; cleared on unmount → no leak. (When a turn stays pending
  // across ticks, `pending` is unchanged so the same interval persists - it does
  // not churn a new timer each tick.)
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setNowTick(Date.now()), PENDING_TICK_MS)
    return () => clearInterval(id)
  }, [pending])

  // PR-9/C: the core POST for ONE bubble + text - shared by a fresh send and
  // Retry. Marks the bubble failed (NEVER throws) and, on a non-202, captures
  // error.code so the failed bubble can render the matching per-state copy.
  const performSend = useCallback(
    async (tempId: string, text: string) => {
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
          // MESSAGE_RECEIVED (messageId === runId). Clear any prior failureCode
          // (a successful Retry).
          const json = (await res.json().catch(() => null)) as { data?: { runId?: string } } | null
          mark({ status: "sent", runId: json?.data?.runId, failureCode: undefined })
        } else {
          // 409 (hibernated/stopped/transitioning) / 502 (gateway) / 429 (rate)
          // / 4xx - mark failed (NEVER throw) and capture error.code so the
          // bubble shows the matching per-state copy (covers the mid-compose
          // race: a RUNNING Claw that changed state between compose and send).
          const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
          mark({ status: "failed", failureCode: json?.error?.code ?? undefined })
        }
      } catch {
        // Network error - no code; the "unknown" reason renders "Failed to send".
        mark({ status: "failed", failureCode: undefined })
      }
    },
    [workspaceId],
  )

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sendable) return
    const tempId = makeTempId()
    setOptimistic((prev) => [...prev, { tempId, text, createdAt: Date.now(), status: "sending" }])
    setDraft("")
    await performSend(tempId, text)
  }, [draft, sendable, performSend])

  // PR-9/C: Retry re-POSTs the SAME text from the failed bubble (the user never
  // retypes). The first attempt genuinely failed, so a fresh server runId is
  // correct - there is no accepted turn to dedupe against.
  const retry = useCallback(
    (tempId: string) => {
      const target = optimistic.find((m) => m.tempId === tempId)
      if (!target) return
      setOptimistic((prev) =>
        prev.map((m) => (m.tempId === tempId ? { ...m, status: "sending", failureCode: undefined } : m)),
      )
      void performSend(tempId, target.text)
    },
    [optimistic, performSend],
  )

  // D6 webchat-silent polish: Retry on a TIMED-OUT turn ("No response"). The
  // original send was accepted (202) but the turn died container-side, so this
  // is a fresh send of the same text - a NEW bubble, NEW idempotencyKey, NEW
  // runId. Never reuse the dead turn's runId: the gateway dedupes on it and
  // would swallow the retry. Works for optimistic AND streamed (post-reload)
  // user rows because it needs only the text.
  const resend = useCallback(
    (text: string) => {
      if (!text) return
      const tempId = makeTempId()
      setOptimistic((prev) => [...prev, { tempId, text, createdAt: Date.now(), status: "sending" }])
      void performSend(tempId, text)
    },
    [performSend],
  )

  const loadOlder = useCallback(async () => {
    if (!nextHistoryCursor || olderLoading) return
    const el = listRef.current
    if (el) {
      prependScrollRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
      nearBottomRef.current = false
    }
    setOlderLoading(true)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/chat/history?limit=${historyPageSize}&before=${encodeURIComponent(nextHistoryCursor)}`,
      )
      const json = (await res.json()) as { success?: boolean; data?: ChatHistoryResponse }
      if (json.success && json.data) {
        setHistoryRows((prev) => mergePersistedChatRows(json.data!.rows, prev))
        setNextHistoryCursor(json.data.nextCursor)
      }
    } catch {
      prependScrollRef.current = null
    } finally {
      setOlderLoading(false)
    }
  }, [historyPageSize, nextHistoryCursor, olderLoading, workspaceId])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // fullHeight: bound the pane to the viewport (header + tabs + bottom gap ≈ 260px).
  // MUTATION: strip max-h-[calc(...)] → unit + Playwright viewport assertions fail.
  // overflow-hidden clips bounce/table overflow so it cannot grow the document.
  return (
    <section
      ref={paneRef}
      aria-label="Web chat"
      style={fullHeight && paneMaxPx ? { maxHeight: paneMaxPx } : undefined}
      className={cn(
        "border border-[var(--bd)] rounded-lg mb-6",
        fullHeight && "flex max-h-[calc(100vh-260px)] flex-col overflow-hidden",
        className,
      )}
    >
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[var(--bd)]">
        <h2 className="text-[12px] font-semibold text-[var(--tx)]">Web chat</h2>
        <p className="text-[11px] text-[var(--tx3)] mt-0.5">
          Direct line to {orchestratorName || "your orchestrator"}. Conversations on connected channels appear in the activity feed.
        </p>
        {working && (
          <p role="status" className="sr-only">
            {orchestratorName || "Orchestrator"} is working…
          </p>
        )}
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className={cn(
          "flex min-w-0 flex-col gap-3 overflow-x-auto overflow-y-auto p-3.5 [overflow-anchor:none]",
          fullHeight ? "min-h-0 flex-1" : "max-h-[360px] min-h-[120px]",
        )}
        role="log"
        aria-label="Chat messages"
      >
        {showJump && (
          <button
            type="button"
            onClick={() => {
              const el = listRef.current
              if (!el) return
              el.scrollTop = el.scrollHeight
              nearBottomRef.current = true
              setShowJump(false)
            }}
            className="sticky top-0 z-10 mx-auto rounded-full border border-[var(--bd)] bg-[var(--bg)] px-3 py-1 text-[11px] font-medium text-[var(--ac-text)] shadow-modal"
          >
            Jump to latest
          </button>
        )}
        {historyEnabled && nextHistoryCursor && (
          <div className="flex justify-center pb-1">
            <Button variant="outline" size="xs" onClick={() => void loadOlder()} loading={olderLoading}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && !working ? (
          <p className="text-[11px] text-[var(--tx3)] py-6 text-center">
            {historyLoading ? "Loading messages..." : "No messages yet. Say hello to get started."}
          </p>
        ) : (
          messages.map((m, index) => {
            const day = formatDay(m.sortTs)
            const previousDay = index > 0 ? formatDay(messages[index - 1].sortTs) : null
            // A user turn whose runId aged out with no reply → quiet "No
            // response" note (distinct from a send failure: the send succeeded).
            const noResponse =
              m.sender === "user" &&
              typeof m.runId === "string" &&
              turnStatuses.get(m.runId) === "no_response"
            // PR-9/C: a failed send shows the SAME tailored per-state copy as the
            // disabled composer (keyed off the captured error.code) instead of a
            // flat "Failed to send". The reason's `cta` drives the affordance -
            // "wake" (send-time HIBERNATED, the mid-compose race) reuses the page's
            // onWake; "retry" (transient) re-POSTs the same text. Symmetric to the
            // pre-send composer so the two surfaces behave identically.
            const failure =
              m.status === "failed" ? chatUnavailableCopy(errorCodeToReason(m.failureCode)) : null
            return (
              <div key={m.key} className="contents">
                {day !== previousDay && (
                  <div className="self-center rounded-full bg-[var(--bg2)] px-3 py-1 text-[10px] text-[var(--tx3)]">
                    {day}
                  </div>
                )}
                <ChatMessage
                  sender={m.sender}
                  senderName={m.senderName}
                  timestamp={formatClock(m.sortTs)}
                  detail={m.detail}
                  action={m.action}
                  status={m.status}
                  noResponse={noResponse}
                  failureMessage={failure?.message ?? null}
                  onRetry={
                    failure?.cta === "retry"
                      ? () => retry(m.key)
                      : noResponse
                        ? () => resend(m.detail ?? m.action)
                        : undefined
                  }
                  onWake={failure?.cta === "wake" ? onWake : undefined}
                />
              </div>
            )
          })
        )}
        {working && <WorkingIndicator orchestratorName={orchestratorName} />}
      </div>

      <div className="shrink-0 border-t border-[var(--bd)] p-3.5">
        {!sendable && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--tx3)]">{composerNote}</p>
            {showWake && (
              <Button variant="primary" size="xs" onClick={onWake}>
                Wake
              </Button>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              fitChatComposer(e.currentTarget)
            }}
            onKeyDown={onKeyDown}
            placeholder={sendable ? "Type a message…" : "Chat unavailable"}
            disabled={!sendable}
            maxLength={MESSAGE_MAX_CHARS}
            rows={COMPOSER_MIN_ROWS}
            aria-label="Message"
            className="flex-1 min-h-[48px] leading-4"
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
