"use client"

import { useCallback, useEffect, useState } from "react"
import { ChatMessage } from "./chat-message"
import { ProviderChannelBadge } from "./provider-channel-badge"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export interface ConversationSummaryView {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount?: number
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

interface ConversationsListResponse {
  available: boolean
  reason?: string
  conversations?: ConversationSummaryView[]
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

const READABLE_STATUSES = new Set(["RUNNING", "PAUSED"])

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

function roleLabel(role: ConversationTextMessageView["role"]): string {
  if (role === "user") return "User"
  return "Assistant"
}

function isToolMessage(message: ConversationMessageView): message is Extract<ConversationMessageView, { type: "tool" }> {
  return message.type === "tool"
}

export function ConversationsSection({ workspaceId, status }: ConversationsSectionProps) {
  const statusReadable = READABLE_STATUSES.has(status)
  const [gatewayAvailable, setGatewayAvailable] = useState(true)
  const [conversations, setConversations] = useState<ConversationSummaryView[]>([])
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ConversationSummaryView | null>(null)
  const [messages, setMessages] = useState<ConversationMessageView[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!statusReadable) return

    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/conversations`)
      .then((res) => res.json())
      .then((json: { success?: boolean; data?: ConversationsListResponse }) => {
        if (cancelled) return
        setLoadedWorkspaceId(workspaceId)
        const data = json.data
        if (!json.success || !data?.available) {
          setGatewayAvailable(false)
          setConversations([])
          return
        }
        setGatewayAvailable(true)
        setConversations(data.conversations ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedWorkspaceId(workspaceId)
          setGatewayAvailable(false)
          setConversations([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [statusReadable, workspaceId])

  const openConversation = useCallback((conversation: ConversationSummaryView) => {
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

  return (
    <section aria-label="Conversations" className="border border-[var(--bd)] rounded-lg mb-6">
      <div className="px-3.5 py-2.5 border-b border-[var(--bd)]">
        <h2 className="text-[12px] font-semibold text-[var(--tx)]">Conversations</h2>
        <p className="text-[11px] text-[var(--tx3)] mt-0.5">
          Read-only gateway transcripts from connected sessions.
        </p>
      </div>

      <div className="p-3.5">
        {!statusReadable || !gatewayAvailable ? (
          <p className="text-[11px] text-[var(--tx3)] py-3">Conversations are readable while the Claw is running.</p>
        ) : loadedWorkspaceId !== workspaceId ? (
          <p className="text-[11px] text-[var(--tx3)] py-3">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)] py-3">No readable gateway conversations yet.</p>
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
                        <ProviderChannelBadge channelId={selected.channelHint} className="flex-none" />
                      </div>
                      <p className="text-[10px] text-[var(--tx3)]">Read-only — reply from the channel itself.</p>
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
