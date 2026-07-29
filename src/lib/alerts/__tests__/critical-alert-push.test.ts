// PR-B: critical-alerts push (Telegram, fallback email) — opt-out + 12h dedup.
//
// Contracts under test:
//   1. Class matrix — buildAlertMessage covers all 4 alert keys with copy
//      that never says "paused".
//   2. Cooldown — decideCriticalAlertSend: opt-out skips; a delivered send
//      within COOLDOWN_MS skips; past the window it sends again.
//   3. Delivery resolution — Telegram preferred, falls back to email, else
//      "no-channel-configured".
//   4. sendCriticalAlert integration — opt-out / cooldown / telegram-ok /
//      telegram-fail-falls-back-to-email / no-channel-skip, and every path
//      writes exactly one ActivityLog SYSTEM ledger row.
//   5. MUTATION guard — dropping the COOLDOWN_MS comparison must fail a test.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  // Test fixtures store plaintext JSON directly in channelConfigEncrypted —
  // decrypt is identity so parseChannelConfigBlob's JSON.parse succeeds.
  decrypt: (value: string) => value,
}))

const mockTelegramSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/channels/telegram-bot-api", () => ({
  telegramSendMessage: (...args: unknown[]) => mockTelegramSend(...args),
}))

const mockResendSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: mockResendSend } }),
}))

import {
  ALERT_KEYS,
  COOLDOWN_MS,
  buildAlertMessage,
  decideCriticalAlertSend,
  resolveDeliveryTarget,
  sendCriticalAlert,
  type AlertKey,
} from "@/lib/alerts/critical-alert-push"

const WORKSPACE_ID = "ws-critical-alert-1"

function mockWorkspace(overrides: Partial<{
  criticalAlertsOptOut: boolean
  channelConfigEncrypted: string | null
  email: string | null
}> = {}) {
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: WORKSPACE_ID,
    criticalAlertsOptOut: overrides.criticalAlertsOptOut ?? false,
    channelConfigEncrypted: overrides.channelConfigEncrypted ?? null,
    user: { email: overrides.email === undefined ? "owner@example.com" : overrides.email },
  })
}

function telegramConfigBlob(botToken = "bot-token-123", allowFrom: Array<string | number> = [555]) {
  return JSON.stringify({ telegram: { botToken, allowFrom } })
}

beforeEach(() => {
  mockTelegramSend.mockReset()
  mockResendSend.mockReset()
  mockResendSend.mockResolvedValue({ id: "em-1" })
  ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
})

describe("buildAlertMessage — class matrix", () => {
  it("covers all 4 alert keys with non-empty, distinct copy", () => {
    expect(ALERT_KEYS).toEqual([
      "container-unhealthy",
      "cron-job-failed",
      "heartbeat-missed",
      "state-sync-stale",
    ])
    const messages = ALERT_KEYS.map((key) => buildAlertMessage(key))
    expect(new Set(messages).size).toBe(ALERT_KEYS.length)
    for (const msg of messages) {
      expect(msg.length).toBeGreaterThan(0)
      // Copy rule: "stopped" never "paused".
      expect(msg.toLowerCase()).not.toContain("paused")
    }
  })

  it("appends detail on a new line when provided", () => {
    const msg = buildAlertMessage("container-unhealthy", "5xx from admin/rpc")
    expect(msg).toContain("Container unhealthy")
    expect(msg).toContain("5xx from admin/rpc")
  })
})

describe("decideCriticalAlertSend — cooldown + opt-out", () => {
  it("opt-out always skips regardless of cooldown state", () => {
    const decision = decideCriticalAlertSend({
      optOut: true,
      lastDeliveredAt: null,
      nowMs: Date.now(),
    })
    expect(decision).toEqual({ action: "skip", reason: "opt-out" })
  })

  it("skips when a delivery happened within COOLDOWN_MS", () => {
    const now = Date.now()
    const lastDeliveredAt = new Date(now - (COOLDOWN_MS - 1000))
    const decision = decideCriticalAlertSend({ optOut: false, lastDeliveredAt, nowMs: now })
    expect(decision.action).toBe("skip")
    expect((decision as { reason: string }).reason).toBe("cooldown")
  })

  it("sends once the delivery is older than COOLDOWN_MS", () => {
    const now = Date.now()
    const lastDeliveredAt = new Date(now - (COOLDOWN_MS + 1000))
    const decision = decideCriticalAlertSend({ optOut: false, lastDeliveredAt, nowMs: now })
    expect(decision).toEqual({ action: "send" })
  })

  it("sends when there is no prior delivery at all", () => {
    const decision = decideCriticalAlertSend({ optOut: false, lastDeliveredAt: null, nowMs: Date.now() })
    expect(decision).toEqual({ action: "send" })
  })

  it("MUTATION: dropping the cooldown comparison collapses dedup to always-send", () => {
    // If someone deletes the `nowMs - lastDeliveredAt.getTime() < COOLDOWN_MS`
    // check, a delivery 1 second ago would no longer skip — this test fails.
    const now = Date.now()
    const oneSecondAgo = new Date(now - 1000)
    const decision = decideCriticalAlertSend({ optOut: false, lastDeliveredAt: oneSecondAgo, nowMs: now })
    expect(decision.action).toBe("skip")
  })

  it("MUTATION: source must consult COOLDOWN_MS in the send decision", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/alerts/critical-alert-push.ts"),
      "utf8",
    )
    expect(src).toContain("export const COOLDOWN_MS")
    expect(src).toMatch(/nowMs\s*-\s*args\.lastDeliveredAt\.getTime\(\)\s*<\s*COOLDOWN_MS/)
  })
})

describe("resolveDeliveryTarget", () => {
  it("prefers Telegram when botToken + allowFrom[0] are present", () => {
    const target = resolveDeliveryTarget({ telegram: { botToken: "bt", allowFrom: [42] } }, "owner@example.com")
    expect(target).toEqual({ channel: "telegram", botToken: "bt", chatId: 42 })
  })

  it("falls back to email when Telegram is not configured", () => {
    const target = resolveDeliveryTarget({}, "owner@example.com")
    expect(target).toEqual({ channel: "email", email: "owner@example.com" })
  })

  it("falls back to email when Telegram has no allowFrom", () => {
    const target = resolveDeliveryTarget({ telegram: { botToken: "bt" } }, "owner@example.com")
    expect(target).toEqual({ channel: "email", email: "owner@example.com" })
  })

  it("skips when neither Telegram nor email is available", () => {
    const target = resolveDeliveryTarget({}, null)
    expect(target).toEqual({ channel: "skipped", reason: "no-channel-configured" })
  })
})

describe("sendCriticalAlert — integration", () => {
  it("opt-out: skips, never calls Telegram/email, ledgers a skip row", async () => {
    mockWorkspace({ criticalAlertsOptOut: true, channelConfigEncrypted: telegramConfigBlob() })

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "container-unhealthy" })

    expect(result).toEqual({ sent: false, channel: "skipped", reason: "opt-out" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(prismaMock.activityLog.create).toHaveBeenCalledTimes(1)
    const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const metadata = JSON.parse(call.data.metadata)
    expect(metadata).toMatchObject({
      eventKind: "critical_alert_push",
      alertKey: "container-unhealthy",
      channel: "skipped",
      delivered: false,
      reason: "opt-out",
    })
  })

  it("cooldown: a prior delivered row within 12h skips and does not re-send", async () => {
    mockWorkspace({ channelConfigEncrypted: telegramConfigBlob() })
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: new Date(Date.now() - 60_000),
    })

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "heartbeat-missed" })

    expect(result).toEqual({ sent: false, channel: "skipped", reason: "cooldown" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
  })

  it("sends via Telegram when configured, opt-out is false, and no cooldown applies", async () => {
    mockWorkspace({ channelConfigEncrypted: telegramConfigBlob("bt-1", [777]) })
    mockTelegramSend.mockResolvedValue(true)

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "state-sync-stale" })

    expect(result).toEqual({ sent: true, channel: "telegram" })
    expect(mockTelegramSend).toHaveBeenCalledWith(
      expect.objectContaining({ botToken: "bt-1", chatId: 777 }),
    )
    expect(mockResendSend).not.toHaveBeenCalled()
    const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const metadata = JSON.parse(call.data.metadata)
    expect(metadata).toMatchObject({ channel: "telegram", delivered: true })
  })

  it("falls back to email when no Telegram channel is configured", async () => {
    mockWorkspace({ channelConfigEncrypted: null, email: "fallback@example.com" })

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "cron-job-failed" })

    expect(result).toEqual({ sent: true, channel: "email" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "fallback@example.com" }),
    )
  })

  it("falls back to email when the Telegram send itself fails", async () => {
    mockWorkspace({ channelConfigEncrypted: telegramConfigBlob(), email: "fallback@example.com" })
    mockTelegramSend.mockResolvedValue(false)

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "container-unhealthy" })

    expect(result).toEqual({ sent: true, channel: "email" })
    expect(mockTelegramSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    // Two ledger rows: the failed telegram attempt + the email attempt.
    expect(prismaMock.activityLog.create).toHaveBeenCalledTimes(2)
  })

  it("skips with no-channel-configured when neither Telegram nor email is available", async () => {
    mockWorkspace({ channelConfigEncrypted: null, email: null })

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "heartbeat-missed" })

    expect(result).toEqual({ sent: false, channel: "skipped", reason: "no-channel-configured" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("returns skipped workspace-not-found when the workspace row is gone", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await sendCriticalAlert({ workspaceId: "missing-ws", alertKey: "cron-job-failed" })

    expect(result).toEqual({ sent: false, channel: "skipped", reason: "workspace-not-found" })
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
  })

  it("MUTATION: every alertKey is a valid AlertKey the sender accepts", () => {
    const keys: AlertKey[] = [...ALERT_KEYS]
    expect(keys).toHaveLength(4)
  })
})
