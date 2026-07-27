import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  resolveWakeReplyDelivery,
  wakeInjectSessionKey,
  WAKE_REPLY_WAIT_MS,
} from "@/lib/hibernation/wake-reply-routing"

describe("resolveWakeReplyDelivery — origin channel → delivery target", () => {
  it("telegram origin → platform_telegram with same chatId", () => {
    expect(resolveWakeReplyDelivery({ channel: "telegram", chatId: 1227037949 })).toEqual({
      mode: "platform_telegram",
      chatId: 1227037949,
    })
  })

  it("wakeInjectSessionKey preserves telegram:{chatId}", () => {
    expect(wakeInjectSessionKey({ channel: "telegram", chatId: 1227037949 })).toBe(
      "telegram:1227037949",
    )
  })

  it("locks reply wait budget for wake path", () => {
    expect(WAKE_REPLY_WAIT_MS).toBe(90_000)
  })

  it("MUTATION: strip telegram → platform_telegram mapping → this test fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-reply-routing.ts"),
      "utf8",
    )
    expect(src).toContain('channel: "telegram"')
    expect(src).toContain('mode: "platform_telegram"')
    expect(src).toContain("platform_telegram")
    // Simulate buggy "always none" routing
    const buggy = (_origin: { channel: string; chatId: number }) => ({ mode: "none" as const })
    expect(buggy({ channel: "telegram", chatId: 1 }).mode).toBe("none")
    expect(resolveWakeReplyDelivery({ channel: "telegram", chatId: 1 }).mode).toBe(
      "platform_telegram",
    )
  })
})
