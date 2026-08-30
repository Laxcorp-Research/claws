// @vitest-environment jsdom
//
// PR-9/B never-blank invariant: a chat bubble's body is `detail || action`,
// NEVER `detail` alone. This locks the graceful-degradation guard that lets
// 9/B not render turnHealth (deferred to 9/C) while never showing an empty
// bubble for an errored agent turn.
//
// MUTATION: change ChatMessage's body to `detail` (alone) and the first test
// renders an empty bubble → getByText("Reply failed") throws → fails.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ChatMessage } from "@/components/dashboard/chat-message"
import { PLATFORM_INTERVIEW_COMPLETE_TOKEN } from "@/lib/chat/platform-sentinels"

afterEach(() => cleanup())

describe("ChatMessage - never-blank bubble (detail || action)", () => {
  it("renders the action text when detail is null (a failed turn is never blank)", () => {
    render(
      <ChatMessage
        sender="agent"
        senderName="Dev Commander"
        timestamp="08:00 UTC"
        detail={null}
        action="Reply failed"
      />,
    )
    expect(screen.getByText("Reply failed")).toBeTruthy()
  })

  it("renders the literal failure text when that's all the reply carried", () => {
    render(
      <ChatMessage
        sender="agent"
        senderName="Dev Commander"
        timestamp="08:00 UTC"
        detail="[assistant turn failed before producing content]"
        action="Reply failed: [assistant turn failed before producing content]"
      />,
    )
    expect(screen.getByText("[assistant turn failed before producing content]")).toBeTruthy()
  })

  it("prefers detail (the full body) over action when detail is present", () => {
    render(
      <ChatMessage
        sender="agent"
        senderName="Dev Commander"
        timestamp="08:00 UTC"
        detail="Here is the full reply body."
        action="Replied: Here is the full"
      />,
    )
    expect(screen.getByText("Here is the full reply body.")).toBeTruthy()
    expect(screen.queryByText("Replied: Here is the full")).toBeNull()
  })

  it("falls back to action when detail is an empty string (contentless healthy turn)", () => {
    render(
      <ChatMessage sender="agent" senderName="Dev Commander" timestamp="08:00 UTC" detail="" action="Replied" />,
    )
    expect(screen.getByText("Replied")).toBeTruthy()
  })

  it("labels the user's own message as the sender it is given (You)", () => {
    render(<ChatMessage sender="user" senderName="You" timestamp="08:00 UTC" detail="hello" action="hello" />)
    expect(screen.getByText("You")).toBeTruthy()
    expect(screen.getByText("hello")).toBeTruthy()
  })

  it("surfaces the failed status note without hiding the message body", () => {
    render(
      <ChatMessage
        sender="user"
        senderName="You"
        timestamp="08:00 UTC"
        detail="this never sent"
        action="this never sent"
        status="failed"
      />,
    )
    expect(screen.getByText("this never sent")).toBeTruthy()
    expect(screen.getByText("Failed to send")).toBeTruthy()
  })

  // WORKING-INDICATOR FIX (Q2): a sent-but-unanswered turn shows a quiet
  // "No response" note that is VISUALLY DISTINCT from the red "Failed to send".
  // The send SUCCEEDED - only the reply is missing - so styling it like a send
  // failure would be wrong information.
  it("renders a quiet 'No response' note (muted --tx3, NOT the red --err 'Failed to send')", () => {
    render(
      <ChatMessage
        sender="user"
        senderName="You"
        timestamp="08:00 UTC"
        detail="went through, no reply"
        action="went through, no reply"
        status="sent"
        noResponse
      />,
    )
    expect(screen.getByText("went through, no reply")).toBeTruthy()
    const note = screen.getByText("No response")
    expect(note).toBeTruthy()
    // Muted token, NOT the error token. MUTATION: style it with --err (like a
    // failure) → this fails.
    expect(note.className).toContain("var(--tx3)")
    expect(note.className).not.toContain("var(--err)")
    // And it is NOT the send-failure note.
    expect(screen.queryByText("Failed to send")).toBeNull()
  })

  // D6 2026-08-23 webchat-silent polish: the timeout state is retryable.
  it("renders a Retry button on 'No response' when onRetry is provided; clicking fires it", () => {
    const onRetry = vi.fn()
    render(
      <ChatMessage
        sender="user"
        senderName="You"
        timestamp="08:23 UTC"
        detail="hello"
        action="hello"
        status="sent"
        noResponse
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText("No response")).toBeTruthy()
    const retry = screen.getByRole("button", { name: "Retry" })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("'No response' without onRetry renders no Retry button (graceful degradation)", () => {
    render(
      <ChatMessage
        sender="user"
        senderName="You"
        timestamp="08:23 UTC"
        detail="hello"
        action="hello"
        status="sent"
        noResponse
      />,
    )
    expect(screen.getByText("No response")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("does NOT render 'No response' when the send itself failed (mutually exclusive)", () => {
    render(
      <ChatMessage
        sender="user"
        senderName="You"
        timestamp="08:00 UTC"
        detail="never sent"
        action="never sent"
        status="failed"
        noResponse
      />,
    )
    // A failed SEND is "Failed to send", never "No response" - the latter would
    // wrongly imply it sent.
    expect(screen.getByText("Failed to send")).toBeTruthy()
    expect(screen.queryByText("No response")).toBeNull()
  })
})

describe("ChatMessage - agent markdown (sanitized) vs user plain text (GAP #1)", () => {
  it("renders agent reply markdown as formatted elements (heading, bold, inline code)", () => {
    render(
      <ChatMessage
        sender="agent"
        senderName="Dev Commander"
        timestamp="08:00 UTC"
        detail={"# Heading\n\n**bold** and `code`"}
        action="x"
      />,
    )
    expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeTruthy()
    expect(screen.getByText("bold").tagName).toBe("STRONG")
    expect(screen.getByText("code").tagName).toBe("CODE")
  })

  it("renders a fenced code block as a <pre>", () => {
    const { container } = render(
      <ChatMessage
        sender="agent"
        senderName="Dev Commander"
        timestamp="08:00 UTC"
        detail={"```\nconst x = 1\n```"}
        action="x"
      />,
    )
    expect(container.querySelector("pre")).not.toBeNull()
    expect(screen.getByText(/const x = 1/)).toBeTruthy()
  })

  it("renders USER markdown as PLAIN text (typing **hi** shows **hi**, not bold)", () => {
    const { container } = render(
      <ChatMessage sender="user" senderName="You" timestamp="08:00 UTC" detail="**hi**" action="**hi**" />,
    )
    expect(screen.getByText("**hi**")).toBeTruthy()
    expect(container.querySelector("strong")).toBeNull()
  })

  // SECURITY LOCK - agent text is untrusted. MUTATION: add rehype-raw / enable
  // raw HTML and the <img>/<script> become real elements → this fails.
  it("renders agent reply SAFELY - no raw HTML elements, no javascript: links", () => {
    const evil =
      '<img src=x onerror="alert(1)"> <script>alert(2)</script> [evil](javascript:alert(3)) [safe](https://example.com)'
    const { container } = render(
      <ChatMessage sender="agent" senderName="Dev Commander" timestamp="08:00 UTC" detail={evil} action="x" />,
    )
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect((a.getAttribute("href") ?? "").toLowerCase().startsWith("javascript:")).toBe(false)
    }
    const safe = screen.getByText("safe")
    expect(safe.getAttribute("href")).toBe("https://example.com")
    expect(safe.getAttribute("rel")).toContain("noopener")
    expect(safe.getAttribute("target")).toBe("_blank")
  })

  it("never-blank holds THROUGH the markdown layer (null detail → action text)", () => {
    render(
      <ChatMessage sender="agent" senderName="Dev Commander" timestamp="08:00 UTC" detail={null} action="Reply failed" />,
    )
    expect(screen.getByText("Reply failed")).toBeTruthy()
  })
})

describe("ChatMessage - long-unbroken-token wrap (no horizontal overflow)", () => {
  // A ~100-char unbroken query token, the case that overflowed the panel.
  const LONG = "https://example.com/x?token=" + "a".repeat(120)

  // The bubble must carry overflow-wrap:anywhere - NOT `break-words`
  // (overflow-wrap:break-word leaves min-content = the whole token, so the
  // content-sized bubble grows past max-w-[85%] and runs off the panel). And
  // NOT break-all (that mid-word-breaks normal text). MUTATION: revert to
  // `break-words` → this fails.
  it("user bubble uses overflow-wrap:anywhere (not break-word/break-all)", () => {
    const { container } = render(
      <ChatMessage sender="user" senderName="You" timestamp="08:00 UTC" detail={LONG} action={LONG} />,
    )
    const bubble = container.querySelector('[class*="rounded-lg"]') as HTMLElement
    expect(bubble).not.toBeNull()
    expect(bubble.className).toContain("overflow-wrap:anywhere")
    expect(bubble.className).not.toContain("break-all")
    expect(screen.getByText(LONG)).toBeTruthy()
  })

  it("hides CLAWS_USER_MD_INTERVIEW_COMPLETE from rendered chat (MUTATION: raw-token-rendered → fail)", () => {
    const raw = `Profile saved. ${PLATFORM_INTERVIEW_COMPLETE_TOKEN}`
    render(
      <ChatMessage
        sender="agent"
        senderName="Twitter Commander"
        timestamp="08:00 UTC"
        detail={raw}
        action={`Replied: ${raw}`}
      />,
    )
    expect(screen.getByText("Profile saved.")).toBeTruthy()
    expect(document.body.textContent).not.toContain(PLATFORM_INTERVIEW_COMPLETE_TOKEN)
    const src = readFileSync(join(process.cwd(), "src/components/dashboard/chat-message.tsx"), "utf8")
    expect(src).toContain("stripPlatformSentinels")
  })

  it("agent bubble uses overflow-wrap:anywhere too (markdown reply with a long token)", () => {
    const { container } = render(
      <ChatMessage sender="agent" senderName="Orchestrator" timestamp="08:00 UTC" detail={`See ${LONG} for details.`} action="x" />,
    )
    const bubble = container.querySelector('[class*="rounded-lg"]') as HTMLElement
    expect(bubble).not.toBeNull()
    expect(bubble.className).toContain("overflow-wrap:anywhere")
    expect(bubble.className).not.toContain("break-all")
  })
})
