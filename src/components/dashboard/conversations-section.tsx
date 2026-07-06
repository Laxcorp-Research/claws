"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ChatMessage } from "./chat-message"
import { ProviderChannelBadge } from "./provider-channel-badge"

export interface ConversationSummaryView {
  sessionKey: string
  channelHint: string
  lastActivityAt: string | null
  messageCount?: number
}

export interface ConversationMessageView {
  role: "user" | "assistant" | "system" | "tool"
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

function roleLabel(role: ConversationMessageView["role"]): string {
  if (role === "user") return "User"
  if (role === "assistant") return "Assistant"
  if (role === "system") return "System"
  return "Tool"
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

  const modalTitle = useMemo(() => {
    if (!selected) return "Conversation"
    return (
      <span className="inline-flex items-center gap-2">
        Conversation
        <ProviderChannelBadge channelId={selected.channelHint} />
      </span>
    )
  }, [selected])

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
          <div className="flex flex-col divide-y divide-[var(--bd)]">
            {conversations.map((conversation) => (
              <button
                key={conversation.sessionKey}
                type="button"
                onClick={() => openConversation(conversation)}
                className="py-2 text-left hover:bg-[var(--bg2)] transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium text-[var(--tx)] truncate">
                        {conversation.sessionKey}
                      </span>
                      <ProviderChannelBadge channelId={conversation.channelHint} />
                    </div>
                    <p className="text-[10px] text-[var(--tx3)] mt-0.5">
                      Last activity {formatTime(conversation.lastActivityAt)}
                    </p>
                  </div>
                  {typeof conversation.messageCount === "number" && (
                    <span className="text-[10px] text-[var(--tx3)] shrink-0">
                      {conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={modalTitle}
        description="Read-only — reply from the channel itself."
        size="lg"
        footer={<Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button>}
      >
        <div className="max-h-[420px] overflow-y-auto flex flex-col gap-3">
          {detailLoading ? (
            <p className="text-[11px] text-[var(--tx3)] py-6 text-center">Loading transcript...</p>
          ) : messages.length === 0 ? (
            <p className="text-[11px] text-[var(--tx3)] py-6 text-center">No transcript messages available.</p>
          ) : (
            messages.map((message, index) => (
              <ChatMessage
                key={`${message.at ?? "no-time"}-${index}`}
                sender={message.role === "user" ? "user" : "agent"}
                senderName={roleLabel(message.role)}
                timestamp={formatTime(message.at)}
                detail={message.content}
                action={message.content}
              />
            ))
          )}
        </div>
      </Modal>
    </section>
  )
}
