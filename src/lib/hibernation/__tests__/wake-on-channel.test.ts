import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"
import {
  decideWakeOnChannel,
  handleTelegramWakeOnChannel,
  WAKE_ON_CHANNEL_ACK,
  WAKE_ON_CHANNEL_FAIL,
} from "@/lib/hibernation/wake-on-channel"
import { telegramWebhookSecretToken } from "@/lib/channels/telegram-bot-api"
import { encrypt } from "@/lib/encryption"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/hibernation/channel-inbound", () => ({
  touchLastChannelMessageAt: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/openclaw/deployer", () => ({
  getGatewayConnectionInfo: vi.fn().mockResolvedValue({
    wsUrl: "wss://claw.test/ws",
    token: "tok",
  }),
}))
vi.mock("@/lib/openclaw/device-identity", () => ({
  generateDeviceIdentity: () => ({ id: "dev", publicKey: "pk", privateKey: "sk" }),
  encryptDeviceIdentity: () => "enc-dev",
  decryptDeviceIdentity: () => ({ id: "dev", publicKey: "pk", privateKey: "sk" }),
}))
vi.mock("@/lib/channels/telegram-bot-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/channels/telegram-bot-api")>(
    "@/lib/channels/telegram-bot-api",
  )
  return {
    ...actual,
    telegramSetWakeWebhook: vi.fn().mockResolvedValue(false),
  }
})

function runAfter(fn: () => void | Promise<void>) {
  return Promise.resolve().then(() => fn())
}

const BOT = "123456789:AA-test-token"
const WS = "ws-hibernated-1"

function telegramUpdate(text = "hello from tg") {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      text,
      chat: { id: 1227037949, type: "private" },
    },
  }
}

function mockHibernatedWorkspace() {
  const blob = encrypt(JSON.stringify({ telegram: { botToken: BOT } }))
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: WS,
    status: "HIBERNATED",
    channelConfigEncrypted: blob,
    containerHost: null,
    gatewayToken: null,
    chatDeviceKeyEncrypted: null,
  })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  ;(prismaMock.containerState.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (ops: Promise<unknown>[]) => Promise.all(ops),
  )
}

describe("decideWakeOnChannel", () => {
  it("HIBERNATED → ack_and_wake; RUNNING → untouched", () => {
    expect(decideWakeOnChannel("HIBERNATED")).toEqual({ action: "ack_and_wake" })
    expect(decideWakeOnChannel("RUNNING")).toEqual({ action: "running_untouched" })
    expect(decideWakeOnChannel("WAKING")).toEqual({ action: "ack_still_waking" })
  })
})

describe("WAKE_ON_CHANNEL_ACK copy lock", () => {
  it("locks exact ack string", () => {
    expect(WAKE_ON_CHANNEL_ACK).toBe("Waking up — one moment")
    expect(WAKE_ON_CHANNEL_FAIL).toContain("Couldn't wake")
  })
})

describe("handleTelegramWakeOnChannel — dead-drop impossible", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHibernatedWorkspace()
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  })

  it("HIBERNATED inbound → ack + wakeWorkspace called", async () => {
    const wake = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(true)
    const deleteWebhook = vi.fn().mockResolvedValue(true)
    const sendChat = vi.fn()
    const afterJobs: Array<Promise<unknown>> = []
    const after = vi.fn((fn: () => void | Promise<void>) => {
      afterJobs.push(runAfter(fn))
    })

    // After wake, status becomes RUNNING for deliver path
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: WS,
        status: "HIBERNATED",
        channelConfigEncrypted: encrypt(JSON.stringify({ telegram: { botToken: BOT } })),
        containerHost: null,
        gatewayToken: null,
        chatDeviceKeyEncrypted: null,
      })
      .mockResolvedValueOnce({
        id: WS,
        status: "RUNNING",
        containerHost: "claw.test",
        gatewayToken: "enc:tok",
        chatDeviceKeyEncrypted: null,
      })

    sendChat.mockResolvedValue({
      ok: true,
      runId: "r1",
      status: "started",
      paired: true,
      replyText: "Agent status: all green",
    })

    const secret = telegramWebhookSecretToken(WS, BOT)
    const result = await handleTelegramWakeOnChannel(
      { workspaceId: WS, update: telegramUpdate(), secretHeader: secret },
      { wakeWorkspace: wake, sendMessage, deleteWebhook, sendChat, after },
    )
    await Promise.all(afterJobs)

    expect(result).toEqual({ ok: true, handled: "ack_and_wake" })
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      botToken: BOT,
      chatId: 1227037949,
      text: WAKE_ON_CHANNEL_ACK,
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WS,
          action: "Wake ack sent",
          actionType: "SYSTEM",
          metadata: expect.stringContaining("wake_ack_sent"),
        }),
      }),
    )
    expect(wake).toHaveBeenCalledWith(WS)
    expect(after).toHaveBeenCalled()
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "telegram:1227037949",
        deliver: false,
        awaitReplyMs: 90_000,
        message: "hello from tg",
      }),
    )
    // Platform delivers agent reply on origin Telegram (same Bot API as ack).
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      botToken: BOT,
      chatId: 1227037949,
      text: "Agent status: all green",
    })
  })

  it("MUTATION: drop wakeWorkspace → contract fails", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-on-channel.ts"),
      "utf8",
    )
    expect(src).toContain("deps.wakeWorkspace")
    expect(src).toContain("WAKE_ON_CHANNEL_ACK")
    expect(src).toContain('after(() =>')
    expect(src).toContain("resolveWakeReplyDelivery")
    expect(src).toContain("platform_telegram")
    expect(src).toContain("deliver: false")
  })

  it("MUTATION: wake-ack Telegram send must ledger wake_ack_sent", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-on-channel.ts"),
      "utf8",
    )
    expect(src).toContain('WAKE_ACK_SENT_EVENT_KIND = "wake_ack_sent"')
    expect(src).toContain("ledgerWakeAckSent")
  })

  it("MUTATION: strip origin-tagging / platform reply send → contract fails", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-on-channel.ts"),
      "utf8",
    )
    expect(src).toContain("wakeInjectSessionKey")
    expect(src).toContain("awaitReplyMs")
    expect(src).toContain("result.replyText")
    expect(src).toMatch(/deliver:\s*false/)
    expect(src).not.toMatch(/deliver:\s*true[,}]/)
  })

  it("RUNNING inbound → wake NOT called (path untouched)", async () => {
    const wake = vi.fn()
    const sendMessage = vi.fn()
    const deleteWebhook = vi.fn().mockResolvedValue(true)
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "RUNNING",
      channelConfigEncrypted: encrypt(JSON.stringify({ telegram: { botToken: BOT } })),
      containerHost: "host",
      gatewayToken: "tok",
      chatDeviceKeyEncrypted: null,
    })

    const secret = telegramWebhookSecretToken(WS, BOT)
    const result = await handleTelegramWakeOnChannel(
      { workspaceId: WS, update: telegramUpdate(), secretHeader: secret },
      {
        wakeWorkspace: wake,
        sendMessage,
        deleteWebhook,
        sendChat: vi.fn(),
        after: vi.fn(),
      },
    )

    expect(result).toEqual({ ok: true, handled: "running_untouched" })
    expect(wake).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(deleteWebhook).toHaveBeenCalledWith(BOT)
  })

  it("wake failure → honest fail message on channel", async () => {
    const wake = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(true)
    const afterJobs: Array<Promise<unknown>> = []
    const after = vi.fn((fn: () => void | Promise<void>) => {
      afterJobs.push(runAfter(fn))
    })

    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: WS,
        status: "HIBERNATED",
        channelConfigEncrypted: encrypt(JSON.stringify({ telegram: { botToken: BOT } })),
        containerHost: null,
        gatewayToken: null,
        chatDeviceKeyEncrypted: null,
      })
      .mockResolvedValueOnce({
        id: WS,
        status: "HIBERNATED",
        containerHost: null,
        gatewayToken: null,
        chatDeviceKeyEncrypted: null,
      })

    const secret = telegramWebhookSecretToken(WS, BOT)
    await handleTelegramWakeOnChannel(
      { workspaceId: WS, update: telegramUpdate(), secretHeader: secret },
      {
        wakeWorkspace: wake,
        sendMessage,
        deleteWebhook: vi.fn(),
        sendChat: vi.fn(),
        after,
      },
    )
    await Promise.all(afterJobs)

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: WAKE_ON_CHANNEL_ACK }),
    )
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: WAKE_ON_CHANNEL_FAIL }),
    )
  })
})
