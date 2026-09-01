import { describe, expect, it } from "vitest"
import {
  formatWorkingLine,
  isBlankAgentReplyBody,
  polishChatRenderText,
  rewriteScheduledSlotCopy,
} from "@/lib/chat/chat-copy"

describe("chat copy polish", () => {
  it("rewrites Scheduled 12:30 UTC to a proposed slot pending approval", () => {
    expect(rewriteScheduledSlotCopy("Scheduled 12:30 UTC")).toBe(
      "proposed slot 12:30 UTC, pending your approval",
    )
    expect(polishChatRenderText("Queued. Scheduled 09:05 UTC after critic.")).toBe(
      "Queued. proposed slot 09:05 UTC, pending your approval after critic.",
    )
  })

  it("does not rewrite admin or badge Scheduled copy", () => {
    expect(rewriteScheduledSlotCopy("Security Update Scheduled")).toBe("Security Update Scheduled")
    expect(rewriteScheduledSlotCopy("Scheduled")).toBe("Scheduled")
  })

  it("treats Replied-only and protocol-only bodies as blank agent replies", () => {
    expect(isBlankAgentReplyBody("Replied", "")).toBe(true)
    expect(isBlankAgentReplyBody("Replied:", null)).toBe(true)
    expect(isBlankAgentReplyBody("Replied: HEARTBEAT_OK", "HEARTBEAT_OK")).toBe(true)
    expect(isBlankAgentReplyBody("Replied: hey there", "hey there")).toBe(false)
  })

  it("formats the run-state line from subagent names", () => {
    expect(formatWorkingLine("Twitter Commander", [])).toBe("Twitter Commander is working...")
    expect(formatWorkingLine("Twitter Commander", ["Twitter Commander", "Scout", "Writer", "Critic"])).toBe(
      "working - Scout, Writer, Critic",
    )
  })
})
