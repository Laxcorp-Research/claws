import { describe, expect, it } from "vitest"
import { hasLaunchChannel } from "@/lib/channels/send-as-claw"

describe("hasLaunchChannel", () => {
  it("is false for web-chat-only config", () => {
    expect(hasLaunchChannel({})).toBe(false)
  })

  it("is true when a launch channel token + allowFrom are present", () => {
    expect(
      hasLaunchChannel({
        telegram: { botToken: "t", allowFrom: [1] },
      }),
    ).toBe(true)
  })
})
