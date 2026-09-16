// PR-B: critical-alerts push (Telegram, fallback email) - opt-out + 12h dedup.
//
// Contracts under test:
//   1. Class matrix - buildAlertMessage covers all alert keys with copy
//      that never says "paused".
//   2. Cooldown - decideCriticalAlertSend: opt-out skips; a delivered send
//      within COOLDOWN_MS skips; past the window it sends again.
//   3. Delivery resolution - Telegram preferred, falls back to email, else
//      "no-channel-configured".
//   4. sendCriticalAlert integration - opt-out / cooldown / telegram-ok /
//      telegram-fail-falls-back-to-email / no-channel-skip, and every path
//      writes exactly one ActivityLog SYSTEM ledger row.
//   5. MUTATION guard - dropping the COOLDOWN_MS comparison must fail a test.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  // Test fixtures store plaintext JSON directly in channelConfigEncrypted -
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
  buildResolveMessage,
  decideCriticalAlertSend,
  resolveDeliveryTarget,
  sendCriticalAlert,
  sendResolveAlert,
  type AlertKey,
} from "@/lib/alerts/critical-alert-push"

const WORKSPACE_ID = "ws-critical-alert-1"

function mockWorkspace(overrides: Partial<{
  criticalAlertsOptOut: boolean
  channelConfigEncrypted: string | null
  email: string | null
  name: string
}> = {}) {
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: WORKSPACE_ID,
    name: overrides.name ?? "Sales Claw",
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

describe("buildAlertMessage - class matrix", () => {
  it("covers all alert keys with non-empty, distinct copy", () => {
    expect(ALERT_KEYS).toEqual([
      "container-unhealthy",
      "cron-job-failed",
      "heartbeat-missed",
      "state-sync-stale",
      "railway-create-budget",
      "provisioning-queued",
      // RESEND HONESTY: raised by the sendEmail wrapper on sustained
      // critical email failure.
      "email-delivery-failed",
      // DIGEST HONESTY: session-plumbing transient storm (agents_wait /
      // sessions_yield) past the ingest threshold - owner page, 12h dedup.
      "tool-transient-storm",
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

describe("decideCriticalAlertSend - cooldown + opt-out", () => {
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
    // check, a delivery 1 second ago would no longer skip - this test fails.
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

describe("sendCriticalAlert - integration", () => {
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
      eventKind: "alert_pushed",
      alertKey: "container-unhealthy",
      channel: "skipped",
      delivered: false,
      reason: "opt-out",
    })
  })

  it("MUTATION: eventKind must be alert_pushed (legacy critical_alert_push still matched for dedup)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/alerts/critical-alert-push.ts"),
      "utf8",
    )
    expect(src).toMatch(/CRITICAL_ALERT_PUSH_EVENT_KIND\s*=\s*"alert_pushed"/)
    expect(src).toContain("CRITICAL_ALERT_PUSH_EVENT_KIND_LEGACY")
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
    mockWorkspace({ channelConfigEncrypted: null, email: "fallback@example.com", name: "Fixture Claw" })

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "cron-job-failed" })

    expect(result).toEqual({ sent: true, channel: "email" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "fallback@example.com",
        subject: "Claws critical alert: Fixture Claw - Cron job failing repeatedly",
      }),
    )
    const html = (mockResendSend.mock.calls[0][0] as { html: string }).html
    expect(html).toContain("Fixture Claw")
  })

  it("MUTATION: critical-alert email subject/body must include workspace name", async () => {
    mockWorkspace({ channelConfigEncrypted: null, email: "owner@example.com", name: "Named Workspace" })
    await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "container-unhealthy" })
    const call = mockResendSend.mock.calls[0][0] as { subject: string; html: string }
    expect(call.subject).toContain("Named Workspace")
    expect(call.html).toContain("Named Workspace")
  })

  it("prefers numeric allowFrom over username when both are present", async () => {
    mockWorkspace({
      channelConfigEncrypted: telegramConfigBlob("bt-1", ["@trader", 777]),
    })
    mockTelegramSend.mockResolvedValue(true)

    await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "state-sync-stale" })

    expect(mockTelegramSend).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 777 }),
    )
  })

  it("falls back to email when the Telegram send itself fails", async () => {
    mockWorkspace({ channelConfigEncrypted: telegramConfigBlob(), email: "fallback@example.com" })
    mockTelegramSend.mockResolvedValue(false)

    const result = await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "container-unhealthy" })

    expect(result).toEqual({ sent: true, channel: "email" })
    expect(mockTelegramSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    // Three ledger rows: failed telegram attempt + the sendEmail wrapper's
    // email_sent row (RESEND HONESTY) + the alert_pushed email attempt.
    expect(prismaMock.activityLog.create).toHaveBeenCalledTimes(3)
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
    expect(keys).toHaveLength(8)
  })

  it("MUTATION: owner-class railway-create-budget must not email the workspace owner", async () => {
    mockWorkspace({ channelConfigEncrypted: null, email: "owner@example.com" })

    const result = await sendCriticalAlert({
      workspaceId: WORKSPACE_ID,
      alertKey: "railway-create-budget",
      dedup: "global",
    })

    expect(result).toEqual({ sent: false, channel: "skipped", reason: "owner-plane" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
  })

  it("MUTATION: provisioning-queued must not page a customer", async () => {
    mockWorkspace({ email: "owner@example.com" })
    const result = await sendCriticalAlert({
      workspaceId: WORKSPACE_ID,
      alertKey: "provisioning-queued",
    })
    expect(result.reason).toBe("customer-alert-disabled")
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it("alert email CTA uses the environment base URL, never hardcoded prod", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.app.buildclaws.ai")
    mockWorkspace({ channelConfigEncrypted: null, email: "owner@example.com" })
    await sendCriticalAlert({ workspaceId: WORKSPACE_ID, alertKey: "container-unhealthy" })
    const html = (mockResendSend.mock.calls[0][0] as { html: string }).html
    expect(html).toContain("https://staging.app.buildclaws.ai/dashboard")
    expect(html).not.toContain("https://app.buildclaws.ai/dashboard")
    vi.unstubAllEnvs()
  })

  it("MUTATION: critical-alert-push must not hardcode the prod dashboard URL", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/alerts/critical-alert-push.ts"),
      "utf8",
    )
    expect(src).not.toContain("https://app.buildclaws.ai/dashboard")
    expect(src).toContain("dashboardUrl")
  })
})

describe("sendResolveAlert", () => {
  it("skips when no prior delivered alert exists", async () => {
    const result = await sendResolveAlert({
      workspaceId: WORKSPACE_ID,
      alertKey: "state-sync-stale",
    })
    expect(result).toEqual({ sent: false, channel: "skipped", reason: "never-alerted" })
    expect(mockTelegramSend).not.toHaveBeenCalled()
  })

  it("sends 'back to normal' after a delivered alert", async () => {
    mockWorkspace({ channelConfigEncrypted: telegramConfigBlob("bt-1", [777]) })
    mockTelegramSend.mockResolvedValue(true)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ timestamp: new Date(Date.now() - 60_000) })
      .mockResolvedValueOnce(null)

    const result = await sendResolveAlert({
      workspaceId: WORKSPACE_ID,
      alertKey: "state-sync-stale",
    })
    expect(result).toEqual({ sent: true, channel: "telegram" })
    expect(mockTelegramSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("back to normal") }),
    )
  })

  it("resolve copy is title: back to normal for every customer-facing key", () => {
    for (const key of ["container-unhealthy", "cron-job-failed", "heartbeat-missed", "state-sync-stale"] as const) {
      expect(buildResolveMessage(key)).toMatch(/: back to normal$/)
    }
  })
})
