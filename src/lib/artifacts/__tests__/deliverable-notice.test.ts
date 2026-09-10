import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockSend = vi.hoisted(() => vi.fn())
const mockParse = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((v: string) => v),
}))
vi.mock("@/lib/alerts/app-url", () => ({
  dashboardUrl: (id: string) => `https://app.example.test/dashboard/${id}`,
}))
vi.mock("@/lib/channels/send-as-claw", () => ({
  sendAsClawChannel: (...args: unknown[]) => mockSend(...args),
}))
vi.mock("@/lib/openclaw/channel-config", () => ({
  parseChannelConfigBlob: (...args: unknown[]) => mockParse(...args),
}))

import {
  buildDeliverableNoticeText,
  notifyDeliverableExtracted,
} from "@/lib/artifacts/deliverable-notice"

describe("buildDeliverableNoticeText", () => {
  it("includes title, preview, and dashboard chat link", () => {
    const text = buildDeliverableNoticeText({
      workspaceId: "ws-1",
      title: "x-content-cycle",
      preview: "Draft A for this week",
      isDecision: false,
    })
    expect(text).toBe(
      [
        "New deliverable: x-content-cycle",
        "Draft A for this week",
        "Open: https://app.example.test/dashboard/ws-1?tab=chat",
      ].join("\n"),
    )
    expect(text).not.toContain("APPROVE")
  })

  it("adds APPROVE/REJECT copy only on decision docs", () => {
    const text = buildDeliverableNoticeText({
      workspaceId: "ws-1",
      title: "x-content-cycle",
      preview: "",
      isDecision: true,
    })
    expect(text).toContain("Reply APPROVE or REJECT to decide.")
    expect(text).not.toContain("reply_markup")
  })
})

describe("notifyDeliverableExtracted", () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockParse.mockReset()
    mockParse.mockReturnValue({ telegram: { botToken: "t", allowFrom: ["1"] } })
    mockSend.mockResolvedValue({ sent: true, channel: "telegram", messageId: 44122 })
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: "{}",
    })
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "n1" })
  })

  it("sends via sendAsClawChannel and ledgers the notice", async () => {
    await notifyDeliverableExtracted({
      workspaceId: "ws-1",
      title: "x-content-cycle",
      logicalPath: "shared/deliverables/x-content-cycle.md",
      fileVersionId: "fv-1",
      preview: "Draft A",
      isDecision: true,
    })
    expect(mockSend).toHaveBeenCalledWith(
      { telegram: { botToken: "t", allowFrom: ["1"] } },
      expect.stringContaining("New deliverable: x-content-cycle"),
    )
    const sentText = mockSend.mock.calls[0][1] as string
    expect(sentText).toContain("Reply APPROVE or REJECT to decide.")
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "Deliverable notice sent via telegram",
        actionType: "SYSTEM",
        metadata: expect.stringContaining('"messageId":44122'),
      }),
    })
  })
})

describe("MUTATION: telegram notices stay text-only", () => {
  it("notice + send-as-claw + telegramSendMessage never grow inline keyboards", () => {
    const files = [
      "src/lib/artifacts/deliverable-notice.ts",
      "src/lib/channels/send-as-claw.ts",
      "src/lib/channels/telegram-bot-api.ts",
    ]
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      expect(src).not.toMatch(/reply_markup/)
      expect(src).not.toMatch(/inline_keyboard/)
    }
    const telegram = readFileSync(
      join(process.cwd(), "src/lib/channels/telegram-bot-api.ts"),
      "utf8",
    )
    expect(telegram).toMatch(/chat_id: args\.chatId/)
    expect(telegram).toMatch(/text: chunk/)
  })
})
