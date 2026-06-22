"use client"

import { cn } from "@/lib/utils"

export type ChatBubbleStatus = "sending" | "sent" | "failed"

interface ChatMessageProps {
  sender: "user" | "agent"
  senderName: string
  timestamp: string
  // PR-9/B GRACEFUL-DEGRADATION GUARD (verified from the container reporter,
  // container/claws-activity-reporter/index.mjs handleAgentEnd):
  //
  //   BUBBLE BODY = detail || action — NEVER `detail` alone.
  //
  // An errored agent turn still yields a non-empty `detail`
  // ("[assistant turn failed before producing content]" or, via
  // extractAssistantReply's fallback, "(no reply produced)"). The ONLY
  // null-detail case (errored + empty text + empty errorMessage) still carries
  // a non-empty `action` ("Reply failed"). A contentless healthy tool-only turn
  // yields action "Replied". So `detail || action` guarantees a bubble is never
  // blank — worst case the literal failure text. This is what lets 9/B NOT
  // render turnHealth (deferred to 9/C) while never showing an empty bubble.
  detail: string | null
  action: string
  status?: ChatBubbleStatus
}

export function ChatMessage({ sender, senderName, timestamp, detail, action, status }: ChatMessageProps) {
  const isUser = sender === "user"
  // NEVER `detail` alone — see the guard note above. Empty-string detail also
  // falls through to action.
  const body = (detail && detail.length > 0 ? detail : action) || ""

  return (
    <div className={cn("flex flex-col gap-[3px] max-w-[85%]", isUser ? "self-end items-end" : "self-start items-start")}>
      <div className="flex items-center gap-1.5 text-[10px] leading-none">
        <span className="font-semibold text-[var(--tx2)]">{senderName}</span>
        <span className="font-mono text-[var(--tx3)]">{timestamp}</span>
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words text-[var(--tx)]",
          isUser ? "bg-[var(--acbg)]" : "bg-[var(--bg2)] border border-[var(--bd)]",
          status === "failed" && "opacity-70",
        )}
      >
        {body}
      </div>
      {status === "sending" && <span className="text-[10px] text-[var(--tx3)]">Sending…</span>}
      {status === "failed" && <span className="text-[10px] text-[var(--err)]">Failed to send</span>}
    </div>
  )
}
