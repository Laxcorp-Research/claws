"use client"

import type { ReactElement } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

export type ChatBubbleStatus = "sending" | "sent" | "failed"

// PR-9/B polish — SECURITY: agent reply text is UNTRUSTED (LLM/container output,
// potentially prompt-injected). We render it with react-markdown v10 whose
// DEFAULT config does NOT parse raw HTML (no `rehype-raw` is added) — so an
// embedded `<script>`/`<img onerror>` is never turned into a DOM element, and
// react-markdown's built-in url sanitizer strips `javascript:`/`vbscript:` hrefs.
// Locked by the XSS test in chat-message.test.tsx (mutation: add rehype-raw →
// the injection test fails). NEVER add rehype-raw or override urlTransform here.
const MD_COMPONENTS: Components = {
  a({ children, href }): ReactElement {
    // href has already passed react-markdown's safe urlTransform.
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-[var(--ac-text)] [overflow-wrap:anywhere]"
      >
        {children}
      </a>
    )
  },
}

// Scoped prose styling for the (12px) agent bubble. Kept as arbitrary variants
// so the markdown stays in this component (no global CSS). Uses design tokens.
const MD_PROSE = cn(
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:text-[14px] [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1",
  "[&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1",
  "[&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5",
  "[&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--bd2)] [&_blockquote]:pl-2 [&_blockquote]:text-[var(--tx2)]",
  "[&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[11px] [&_:not(pre)>code]:bg-[var(--bg3)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded",
  "[&_pre]:bg-[var(--bg3)] [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:my-1 [&_pre_code]:font-mono [&_pre_code]:text-[11px]",
  "[&_table]:block [&_table]:overflow-x-auto [&_th]:text-left [&_th]:pr-3 [&_td]:pr-3 [&_th]:border-b [&_th]:border-[var(--bd)]",
)

function MarkdownBody({ content }: { content: string }): ReactElement {
  return (
    <div className={MD_PROSE}>
      {/* SECURITY: never add rehype-raw — agent replies are untrusted; raw HTML = XSS.
          The injection test in chat-message.test.tsx locks this. */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

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
  // a non-empty `action` ("Reply failed"). So `detail || action` guarantees a
  // bubble is never blank — and the markdown layer below receives the already-
  // guarded body, so it cannot reintroduce a blank bubble.
  detail: string | null
  action: string
  status?: ChatBubbleStatus
  // WORKING-INDICATOR FIX: the turn was sent (202) but no reply arrived within
  // the timeout. Renders a SUBTLE, muted "No response" note — deliberately
  // DISTINCT from the red "Failed to send": the message DID send; the agent just
  // never replied. Same styling for both would be wrong information.
  noResponse?: boolean
  // PR-9/C: on a failed send, the panel passes the tailored per-state copy here
  // (e.g. "Your Claw is asleep — wake it to chat.") to REPLACE the flat "Failed
  // to send". Absent/empty → the legacy "Failed to send" (network errors, direct
  // callers).
  failureMessage?: string | null
  // PR-9/C: present on a transient failure (502 unreachable, 429, network) — a
  // Retry that re-POSTs the SAME text (the user never retypes).
  onRetry?: () => void
}

export function ChatMessage({ sender, senderName, timestamp, detail, action, status, noResponse, failureMessage, onRetry }: ChatMessageProps) {
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
          // overflow-wrap:anywhere (not `break-words`/break-word): only `anywhere`
          // collapses the bubble's min-content width so a long unbroken token (e.g. a
          // 100-char URL) wraps inside the max-w-[85%] bubble instead of overflowing
          // the panel. `break-all` is wrong here — it would mid-word-break normal text.
          "rounded-lg px-3 py-2 text-[12px] leading-snug [overflow-wrap:anywhere] text-[var(--tx)]",
          isUser ? "bg-[var(--acbg)]" : "bg-[var(--bg2)] border border-[var(--bd)]",
          status === "failed" && "opacity-70",
        )}
      >
        {/* User input is rendered as PLAIN text (typing "**hi**" shows "**hi**").
            Only agent replies are markdown — and they are sanitized (see MD_COMPONENTS). */}
        {isUser ? <span className="whitespace-pre-wrap">{body}</span> : <MarkdownBody content={body} />}
      </div>
      {status === "sending" && <span className="text-[10px] text-[var(--tx3)]">Sending…</span>}
      {/* PR-9/C: tailored per-state copy (e.g. "Your Claw is asleep — wake it to
          chat.") replaces the flat "Failed to send" when the panel supplies it;
          a transient failure also offers a Retry that re-sends the same text. */}
      {status === "failed" && (
        <span className="inline-flex items-center gap-2 text-[10px]">
          <span className="text-[var(--err)]">{failureMessage || "Failed to send"}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium text-[var(--ac-text)] underline cursor-pointer"
            >
              Retry
            </button>
          )}
        </span>
      )}
      {/* Muted (--tx3), NOT red (--err): the send succeeded; only the reply is
          missing. `status === "failed"` and `noResponse` are mutually exclusive
          by construction (a failed send never starts a tracked turn). */}
      {noResponse && status !== "failed" && (
        <span className="text-[10px] italic text-[var(--tx3)]">No response</span>
      )}
    </div>
  )
}
