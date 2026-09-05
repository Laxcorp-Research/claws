import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import {
  isExternalChannelInbound,
  touchLastChannelMessageAt,
} from "@/lib/hibernation/channel-inbound"

describe("isExternalChannelInbound", () => {
  it("accepts MESSAGE_RECEIVED on CHANNEL_IDS + webchat", () => {
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "telegram")).toBe(true)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "telegram:1227037949")).toBe(true)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "discord")).toBe(true)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "webchat")).toBe(true)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "webchat:ws-1")).toBe(true)
  })

  it("rejects non-inbound types and unknown channels", () => {
    expect(isExternalChannelInbound("MESSAGE_SENT", "telegram")).toBe(false)
    expect(isExternalChannelInbound("HEARTBEAT", "telegram")).toBe(false)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", null)).toBe(false)
    expect(isExternalChannelInbound("MESSAGE_RECEIVED", "sms")).toBe(false)
  })
})

describe("touchLastChannelMessageAt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
  })

  it("writes lastChannelMessageAt for the workspace", async () => {
    const at = new Date("2026-07-19T08:00:00.000Z")
    await touchLastChannelMessageAt("ws-1", at)
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { lastChannelMessageAt: at, lastActiveAt: at },
    })
  })

  it("MUTATION: activity route must call touch on inbound (drop writer → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/activity/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain("isExternalChannelInbound")
    expect(src).toContain("touchLastChannelMessageAt")
  })
})
