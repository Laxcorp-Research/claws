import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const mockTelegramSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/channels/telegram-bot-api", () => ({
  telegramSendMessage: (...args: unknown[]) => mockTelegramSend(...args),
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

  it("MUTATION: owner-alert module must not read workspace.user.email or raw Resend", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/alerts/owner-alert.ts"), "utf8")
    expect(src).not.toContain("user.email")
    expect(src).not.toContain("workspace.user")
    expect(src).not.toContain("getResend")
    expect(src).not.toContain(".emails.send(")
    expect(src).toContain("ADMIN_ALERT_EMAIL")
    expect(src).toContain("sendEmail")
  })
})
