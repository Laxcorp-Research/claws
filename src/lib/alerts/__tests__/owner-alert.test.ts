import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const mockTelegramSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/channels/telegram-bot-api", () => ({
  telegramSendMessageDetailed: (...args: unknown[]) => mockTelegramSend(...args),
  telegramSendMessage: async (...args: unknown[]) => {
    const r = await mockTelegramSend(...args)
    return r === true || (r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok)
  },
}))

const mockSendEmail = vi.hoisted(() => vi.fn())
vi.mock("@/lib/email/send-email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sendOwnerAlert } from "@/lib/alerts/owner-alert"

describe("sendOwnerAlert", () => {
  beforeEach(() => {
    mockTelegramSend.mockReset()
    mockSendEmail.mockReset()
    mockSendEmail.mockResolvedValue({ ok: true })
    vi.stubEnv("ADMIN_ALERT_EMAIL", "founder@laxcorp.com")
    vi.stubEnv("FOUNDER_TELEGRAM_BOT_TOKEN", "")
    vi.stubEnv("FOUNDER_TELEGRAM_CHAT_ID", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("emails ADMIN_ALERT_EMAIL, never a customer address", async () => {
    const result = await sendOwnerAlert({
      alertKey: "railway-create-budget",
      title: "Railway create budget at 80%",
      workspaceId: "ws-customer",
    })
    expect(result.sent).toBe(true)
    expect(result.channel).toBe("email")
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "founder@laxcorp.com", kind: "owner_alert" }),
    )
    const to = (mockSendEmail.mock.calls[0][0] as { to: string }).to
    expect(to).not.toBe("owner@example.com")
  })

  it("fans out to founder Telegram AND ADMIN_ALERT_EMAIL when both are set (MUTATION: telegram-only early return → fail)", async () => {
    vi.stubEnv("FOUNDER_TELEGRAM_BOT_TOKEN", "test-bot-token")
    vi.stubEnv("FOUNDER_TELEGRAM_CHAT_ID", "1227037949")
    mockTelegramSend.mockResolvedValue({ ok: true, messageId: 108 })

    const result = await sendOwnerAlert({
      alertKey: "railway-create-budget",
      title: "Railway create budget at 80%",
      workspaceId: "ws-customer",
    })

    expect(result.sent).toBe(true)
    expect(result.channel).toBe("both")
    expect(result.telegramSent).toBe(true)
    expect(result.emailSent).toBe(true)
    expect(result.telegramMessageId).toBe(108)
    expect(mockTelegramSend).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "1227037949" }),
    )
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "founder@laxcorp.com", kind: "owner_alert" }),
    )
  })

  it("MUTATION: owner-alert module must not read workspace.user.email or raw Resend", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/alerts/owner-alert.ts"), "utf8")
    expect(src).not.toContain("user.email")
    expect(src).not.toContain("workspace.user")
    expect(src).not.toContain("getResend")
    expect(src).not.toContain(".emails.send(")
    expect(src).toContain("ADMIN_ALERT_EMAIL")
    expect(src).toContain("sendEmail")
    expect(src).toContain('channel: "both"')
    expect(src).not.toMatch(/if \(ok\) return \{ sent: true, channel: "telegram" \}/)
  })
})
