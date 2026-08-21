"use client"

import { useCallback, useEffect, useState } from "react"
import { ChatMessage } from "./chat-message"
import { ProviderChannelBadge } from "./provider-channel-badge"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { AlertBanner } from "@/components/ui/alert-banner"
import {
  CONVERSATIONS_MODE_LIVE,
  CONVERSATIONS_MODE_SNAPSHOT,
  isConversationReadableStatus,
  isLiveGatewayStatus,
} from "@/lib/openclaw/conversation-readability"

export interface ConversationSummaryView {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount?: number
}

export interface ArchivedSessionView {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount: number
  reason: "rotated-main" | "deleted" | "reset" | "not-in-index"
}

export type ConversationMessageView =
  | {
    type?: "message"
    role: "user" | "assistant"
    content: string
    at: string | null
  }
  | {
    type: "tool"
    name: string
    at: string | null
  }

interface ConversationTextMessageView {
  type?: "message"
  role: "user" | "assistant"
  content: string
  at: string | null
}

type ListUnavailableReason = "not_running" | "unreachable" | "too_large" | "corrupt"

interface ConversationsListResponse {
  available: boolean
  mode?: typeof CONVERSATIONS_MODE_LIVE | typeof CONVERSATIONS_MODE_SNAPSHOT
  asOf?: string
  reason?: ListUnavailableReason
  message?: string
  conversations?: ConversationSummaryView[]
  archived?: ArchivedSessionView[]
}

interface ConversationDetailResponse {
  available: boolean
  reason?: string
  sessionKey?: string
  messages?: ConversationMessageView[]
}

interface ConversationsSectionProps {
  workspaceId: string
  status: string
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready"
      mode: typeof CONVERSATIONS_MODE_LIVE | typeof CONVERSATIONS_MODE_SNAPSHOT
      asOf: string | null
      conversations: ConversationSummaryView[]
      archived: ArchivedSessionView[]
    }
  | { kind: "unavailable"; reason: ListUnavailableReason; asOf: string | null; message?: string }
  | { kind: "error" }

function formatTime(iso: string | null): string {
  if (!iso) return "unknown"
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return "unknown"
  return `${new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`
}

function formatAsOfBanner(iso: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Date(parsed).toISOString().replace(".000Z", "Z")
}

function roleLabel(role: ConversationTextMessageView["role"]): string {
  if (role === "user") return "User"
  return "Assistant"
}

function isToolMessage(message: ConversationMessageView): message is Extract<ConversationMessageView, { type: "tool" }> {
  return message.type === "tool"
}

function archivedReasonLabel(reason: ArchivedSessionView["reason"]): string {
  switch (reason) {
    case "rotated-main":
      return "rotated main"
    case "deleted":
      return "deleted"
    case "reset":
      return "reset"
    case "not-in-index":
      return "not in index"
  }
}

function emptyCopy(args: {
  status: string
  load: LoadState
}): string {
  if (args.load.kind === "unavailable") {
    if (args.load.reason === "corrupt") {
      return "Saved conversation history is unreadable. Wake the Claw to rebuild history, or sync again."
    }
    if (args.load.reason === "too_large") {
      return args.load.message ?? "Saved history too large - wake to view."
    }
    if (args.load.reason === "unreachable") {
      return "Conversations are temporarily unreachable."
    }
    // not_running - distinguish no saved history vs no sessions handled at ready+empty
    if (isLiveGatewayStatus(args.status)) {
      return "Conversations are readable while the Claw is running."
    }
    return "No saved conversation history yet. Wake or run the Claw once to capture history."
  }
  if (args.load.kind === "error") {
    return "Could not load conversations."
  }
  if (args.load.kind === "ready" && args.load.conversations.length === 0) {
    return "No readable conversations in saved history."
  }
  return "No readable conversations yet."
}

export function ConversationsSection({ workspaceId, status }: ConversationsSectionProps) {
  const statusReadable = isConversationReadableStatus(status)
  const [load, setLoad] = useState<LoadState>({ kind: "idle" })
  const [selected, setSelected] = useState<ConversationSummaryView | ArchivedSessionView | null>(null)
  const [messages, setMessages] = useState<ConversationMessageView[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!statusReadable) {
      setLoad({ kind: "unavailable", reason: "not_running", asOf: null })
      return
    }

    let cancelled = false
    setLoad({ kind: "loading" })
    setSelected(null)
    setMessages([])

    fetch(`/api/workspaces/${workspaceId}/conversations`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: ConversationsListResponse }) => {
        if (cancelled) return
        const data = json.data
        if (!json.success || !data) {
          setLoad({ kind: "error" })
          return
        }
        if (!data.available) {
          setLoad({
            kind: "unavailable",
            reason: data.reason ?? "not_running",
            asOf: data.asOf ?? null,
            message: data.message,
          })
          return
        }
        setLoad({
          kind: "ready",
          mode: data.mode === CONVERSATIONS_MODE_SNAPSHOT
            ? CONVERSATIONS_MODE_SNAPSHOT
            : CONVERSATIONS_MODE_LIVE,
          asOf: data.asOf ?? null,
          conversations: data.conversations ?? [],
          archived: data.archived ?? [],
        })
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [statusReadable, workspaceId])

  const openConversation = useCallback((conversation: ConversationSummaryView | ArchivedSessionView) => {
    setSelected(conversation)
    setMessages([])
    setDetailLoading(true)
    fetch(`/api/workspaces/${workspaceId}/conversations/${encodeURIComponent(conversation.sessionKey)}`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: ConversationDetailResponse }) => {
        const data = json.data
        if (!json.success || !data?.available) {
          setMessages([])
          return
        }
        setMessages(data.messages ?? [])
      })
      .catch(() => setMessages([]))
      .finally(() => setDetailLoading(false))
  }, [workspaceId])

  const bannerText = (() => {
    if (status === "WAKING") {
      const asOf =
        load.kind === "ready" || load.kind === "unavailable" ? load.asOf : null
      return asOf
        ? `Waking · showing saved history as of ${formatAsOfBanner(asOf)}`
        : "Waking · conversation history will appear when saved history is available"
    }
    if (status === "DEPLOYING" && load.kind === "ready" && load.asOf) {
      return `Deploying · showing saved history as of ${formatAsOfBanner(load.asOf)}`
    }
    if (load.kind === "ready" && load.mode === CONVERSATIONS_MODE_SNAPSHOT && load.asOf) {
      return `Read-only · as of ${formatAsOfBanner(load.asOf)}`
    }
    return null
  })()

  const archived = load.kind === "ready" ? load.archived : []
  const conversations = load.kind === "ready" ? load.conversations : []
  const showList = load.kind === "ready"
  const emptyMessage = emptyCopy({ status, load })

  return (
    <section aria-label="Conversations" className="border border-[var(--bd)] rounded-lg mb-6">
      <div className="px-3.5 py-2.5 border-b border-[var(--bd)]">
        <h2 className="text-[12px] font-semibold text-[var(--tx)]">Conversations</h2>
        <p className="text-[11px] text-[var(--tx3)] mt-0.5">
          Read-only session transcripts from connected channels.
        </p>
      </div>

      <div className="p-3.5">
        {bannerText && (
          <AlertBanner variant="info">
            <p data-testid="conversations-readonly-banner">{bannerText}</p>
          </AlertBanner>
        )}
        {load.kind === "unavailable" && load.reason === "corrupt" && (
          <AlertBanner variant="error">
            <p data-testid="conversations-corrupt-banner">
              Saved history is corrupt - cannot read conversation history.
            </p>
          </AlertBanner>
        )}

        {load.kind === "loading" || load.kind === "idle" ? (
          <p className="text-[11px] text-[var(--tx3)] py-3">Loading conversations...</p>
        ) : !showList ? (
          <p className="text-[11px] text-[var(--tx3)] py-3" data-testid="conversations-empty">
            {emptyMessage}
          </p>
        ) : conversations.length === 0 && archived.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)] py-3" data-testid="conversations-empty">
            {emptyMessage}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
            <div className="max-h-[520px] overflow-y-auto rounded-[10px] border border-[var(--bd)]">
              {conversations.map((conversation) => {
                const active = selected?.sessionKey === conversation.sessionKey
                return (
                  <button
                    key={conversation.sessionKey}
                    type="button"
                    onClick={() => openConversation(conversation)}
                    className={`w-full border-b border-[var(--bd)] px-3 py-2 text-left transition-colors last:border-b-0 ${active ? "bg-[var(--bg2)]" : "hover:bg-[var(--bg2)]"}`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1">
                        <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">{conversation.sessionKey}</TruncatedText>
                      </span>
                      <ProviderChannelBadge channelId={conversation.channelHint} className="flex-none" />
                    </div>
                    <p className="mt-0.5 text-[10px] text-[var(--tx3)]">Last activity {formatTime(conversation.lastActivityAt)}</p>
                    {typeof conversation.messageCount === "number" && (
                      <p className="mt-0.5 text-[10px] text-[var(--tx3)]">{conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"}</p>
                    )}
                  </button>
                )
              })}

              {archived.length > 0 && (
                <div data-testid="conversations-archived" className="border-t border-[var(--bd)]">
                  <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">
                    Archived sessions
                  </p>
                  {archived.map((entry) => {
                    const active = selected?.sessionKey === entry.sessionKey
                    return (
                      <button
                        key={entry.sessionKey}
                        type="button"
                        onClick={() => openConversation(entry)}
                        className={`w-full border-b border-[var(--bd)] px-3 py-2 text-left transition-colors last:border-b-0 ${active ? "bg-[var(--bg2)]" : "hover:bg-[var(--bg2)]"}`}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1">
                            <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">{entry.sessionKey}</TruncatedText>
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-[var(--tx3)]">
                          {archivedReasonLabel(entry.reason)} · Last activity {formatTime(entry.lastActivityAt)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[var(--tx3)]">
                          {entry.messageCount} message{entry.messageCount === 1 ? "" : "s"}
                        </p>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="min-h-[360px] rounded-[10px] border border-[var(--bd)] p-3">
              {!selected ? (
                <p className="py-10 text-center text-[11px] text-[var(--tx3)]">Select a conversation to view its transcript.</p>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--bd)] pb-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 flex-1">
                          <TruncatedText className="text-[12px] font-semibold text-[var(--tx)]">{selected.sessionKey}</TruncatedText>
                        </span>
                        {"channelHint" in selected && (
                          <ProviderChannelBadge channelId={selected.channelHint} className="flex-none" />
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--tx3)]">Read-only - reply from the channel itself.</p>
                    </div>
                  </div>
                  <div className="max-h-[470px] overflow-y-auto overflow-x-hidden flex flex-col gap-3">
                    {detailLoading ? (
                      <p className="text-[11px] text-[var(--tx3)] py-6 text-center">Loading transcript...</p>
                    ) : messages.length === 0 ? (
                      <p className="text-[11px] text-[var(--tx3)] py-6 text-center">No transcript messages available.</p>
                    ) : (
                      messages.map((message, index) => (
                        isToolMessage(message) ? (
                          <div
                            key={`${message.at ?? "no-time"}-${index}`}
                            className="self-start max-w-[85%] rounded-lg border border-[var(--bd)] bg-[var(--bg2)] px-3 py-1.5 text-[11px] leading-snug text-[var(--tx3)] [overflow-wrap:anywhere]"
                          >
                            · used {message.name}
                          </div>
                        ) : (
                          <ChatMessage
                            key={`${message.at ?? "no-time"}-${index}`}
                            sender={message.role === "user" ? "user" : "agent"}
                            senderName={roleLabel(message.role)}
                            timestamp={formatTime(message.at)}
                            detail={message.content}
                            action={message.content}
                          />
                        )
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
