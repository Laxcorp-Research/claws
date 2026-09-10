import { describe, expect, it } from "vitest"
import { POISON_RECOVERING_LINE } from "@/lib/trial/thinking-signature-heal"
import {
  isNarrationChatBody,
  isPlatformInjectionBody,
  sessionKeyLooksSubagent,
  shouldDropChatBubble,
} from "@/lib/chat/transcript-filter"

describe("transcript-filter", () => {
  it("drops subagent sessionKeys", () => {
    expect(sessionKeyLooksSubagent("agent:twitter-commander:subagent:critic:7f2b")).toBe(true)
    expect(sessionKeyLooksSubagent("agent:twitter-commander:main")).toBe(false)
    expect(
      shouldDropChatBubble({
        actionType: "MESSAGE_SENT",
        sessionKey: "agent:twitter-commander:subagent:critic:7f2b",
        action: "Replied: draft",
        detail: "draft",
      }),
    ).toBe(true)
  })

  it("drops narration bubbles", () => {
    expect(isNarrationChatBody("Task started: critic", null)).toBe(true)
    expect(isNarrationChatBody("Task completed in 12s", null)).toBe(true)
    expect(isNarrationChatBody("Subagent Context", "foo")).toBe(true)
    expect(
      shouldDropChatBubble({
        actionType: "MESSAGE_SENT",
        sessionKey: "agent:twitter-commander:main",
        action: "Task started: critic",
        detail: "Task started: critic",
      }),
    ).toBe(true)
  })

  it("keeps poison / overlay boot so they render as platform lines", () => {
    expect(isPlatformInjectionBody(POISON_RECOVERING_LINE)).toBe(true)
    expect(isPlatformInjectionBody("Claws overlay boot 2026.5.22-18")).toBe(true)
    expect(
      shouldDropChatBubble({
        actionType: "MESSAGE_SENT",
        sessionKey: "agent:twitter-commander:main",
        action: POISON_RECOVERING_LINE,
        detail: POISON_RECOVERING_LINE,
      }),
    ).toBe(false)
    expect(
      shouldDropChatBubble({
        actionType: "MESSAGE_SENT",
        sessionKey: "agent:twitter-commander:main",
        action: "Claws overlay boot 2026.5.22-18",
        detail: "Claws overlay boot 2026.5.22-18",
      }),
    ).toBe(false)
  })
})
