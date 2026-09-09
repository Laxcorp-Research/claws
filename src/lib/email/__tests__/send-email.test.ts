// RESEND ERROR HONESTY (2026-08-25): the Resend SDK resolves
// `{ data: null, error }` on a rejected send instead of throwing, and every
// call site treated a resolved promise as delivered. These tests lock the
// wrapper's contract: the resolved error field IS a failure (mutation lock),
// every attempt is ledgered to ActivityLog when workspace context exists,
// critical sends retry exactly once, and sustained critical failures
// escalate to the email-delivery-failed critical alert.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: mockSend } }),
}))

const mockSendCriticalAlert = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: (...args: unknown[]) => mockSendCriticalAlert(...args),
}))

import {
  DEFAULT_EMAIL_FROM,
  EMAIL_FAILED_EVENT_KIND,
  EMAIL_SENT_EVENT_KIND,
  sendEmail,
} from "@/lib/email/send-email"

function activityCreateCalls() {
  return (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[0].data,
  )
}

beforeEach(() => {
  mockSend.mockReset()
  mockSendCriticalAlert.mockReset().mockResolvedValue({ sent: true, channel: "telegram" })
  ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe("sendEmail - honest success", () => {
  it("delivers, returns ok, and ledgers email_sent per workspace", async () => {
    mockSend.mockResolvedValue({ data: { id: "em-1" }, error: null })

    const result = await sendEmail({
      kind: "trial_expiry_notify",
      workspaceIds: ["ws-a", "ws-b"],
      to: "user@example.com",
      subject: "s",
      html: "<p>h</p>",
    })

    expect(result).toEqual({ ok: true, attempts: 1, resendId: "em-1" })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith({
      from: DEFAULT_EMAIL_FROM,
      to: "user@example.com",
      subject: "s",
      html: "<p>h</p>",
    })
    const rows = activityCreateCalls()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.workspaceId)).toEqual(["ws-a", "ws-b"])
    for (const row of rows) {
      expect(row.actionType).toBe("SYSTEM")
      expect(row.action).toBe("Email sent (trial_expiry_notify)")
      const meta = JSON.parse(row.metadata)
      expect(meta).toMatchObject({
        eventKind: EMAIL_SENT_EVENT_KIND,
        emailKind: "trial_expiry_notify",
        to: "user@example.com",
        attempts: 1,
      })
      expect(meta.resendId).toBe("em-1")
    }
  })

  it("no workspace context: still sends, no ActivityLog rows (nothing to attach to)", async () => {
    mockSend.mockResolvedValue({ data: { id: "em-2" }, error: null })

    const result = await sendEmail({
      kind: "magic_link",
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result.ok).toBe(true)
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
  })
})

describe("sendEmail - honest failure (the whole point)", () => {
  it("MUTATION: a RESOLVED { error } response is a failure - restoring the ignore-error bug fails here", async () => {
    // This is exactly what the SDK does on a rejected send: it RESOLVES.
    // The pre-wrapper call sites saw a resolved promise and reported success.
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "You have reached your daily email quota", name: "rate_limit_exceeded" },
    })

    const result = await sendEmail({
      kind: "trial_expiry_notify",
      workspaceIds: ["ws-a"],
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({
      ok: false,
      attempts: 1,
      reason: "You have reached your daily email quota",
    })
    const rows = activityCreateCalls()
    expect(rows).toHaveLength(1)
    expect(rows[0].actionType).toBe("ERROR")
    expect(rows[0].action).toBe("Email failed (trial_expiry_notify)")
    expect(rows[0].detail).toBe("You have reached your daily email quota")
    const meta = JSON.parse(rows[0].metadata)
    expect(meta).toMatchObject({
      eventKind: EMAIL_FAILED_EVENT_KIND,
      reason: "You have reached your daily email quota",
    })
  })

  it("a thrown rejection is also a typed failure with its message as reason", async () => {
    mockSend.mockRejectedValue(new Error("fetch failed"))

    const result = await sendEmail({
      kind: "credit_pool_alert",
      to: "admin@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({ ok: false, attempts: 1, reason: "fetch failed" })
  })

  it("non-critical sends never retry", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "boom" } })

    const result = await sendEmail({
      kind: "template_approved",
      to: "creator@example.com",
      subject: "s",
      html: "h",
    })

    expect(result.ok).toBe(false)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("ledger write failure never masks a successful send", async () => {
    mockSend.mockResolvedValue({ data: { id: "em-3" }, error: null })
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    )

    const result = await sendEmail({
      kind: "credits_exhausted_stop",
      workspaceIds: ["ws-a"],
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({ ok: true, attempts: 1, resendId: "em-3" })
  })
})

describe("sendEmail - critical retry + escalation", () => {
  it("critical: retries exactly once and succeeds on the second attempt", async () => {
    mockSend
      .mockResolvedValueOnce({ data: null, error: { message: "transient" } })
      .mockResolvedValueOnce({ data: { id: "em-4" }, error: null })

    const result = await sendEmail({
      kind: "trial_expiry_stop",
      critical: true,
      workspaceIds: ["ws-a"],
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({ ok: true, attempts: 2, resendId: "em-4" })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
    const meta = JSON.parse(activityCreateCalls()[0].metadata)
    expect(meta.attempts).toBe(2)
  })

  it("critical still-failed: escalates via the email-delivery-failed critical alert (owner Telegram path)", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "hard down" } })

    const result = await sendEmail({
      kind: "trial_expiry_stop",
      critical: true,
      workspaceIds: ["ws-a", "ws-b"],
      escalateWorkspaceId: "ws-a",
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({ ok: false, attempts: 2, reason: "hard down" })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSendCriticalAlert).toHaveBeenCalledTimes(1)
    expect(mockSendCriticalAlert).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      alertKey: "email-delivery-failed",
      detail: expect.stringContaining("trial_expiry_stop"),
    })
  })

  it("MUTATION: dropping the retry collapses critical sends to one attempt - this fails", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "down" } })

    await sendEmail({
      kind: "payout_paid",
      critical: true,
      to: "creator@example.com",
      subject: "s",
      html: "h",
    })

    // A critical failure must have burned BOTH attempts before reporting.
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("loop guard: critical_alert_fallback never escalates even when asked to", async () => {
    // The escalation path itself sends email via this wrapper - escalating
    // its own failure would recurse into another critical alert.
    mockSend.mockResolvedValue({ data: null, error: { message: "down" } })

    const result = await sendEmail({
      kind: "critical_alert_fallback",
      critical: true,
      escalateWorkspaceId: "ws-a",
      workspaceIds: ["ws-a"],
      to: "owner@example.com",
      subject: "s",
      html: "h",
    })

    expect(result.ok).toBe(false)
    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
  })

  it("non-critical failure never escalates even with an escalation target", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "down" } })

    await sendEmail({
      kind: "security_update",
      escalateWorkspaceId: "ws-a",
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
  })

  it("escalation failure is swallowed (logged) - the typed result still reports the send failure", async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: "down" } })
    mockSendCriticalAlert.mockRejectedValue(new Error("alert path down"))

    const result = await sendEmail({
      kind: "trial_expiry_stop",
      critical: true,
      escalateWorkspaceId: "ws-a",
      to: "user@example.com",
      subject: "s",
      html: "h",
    })

    expect(result).toEqual({ ok: false, attempts: 2, reason: "down" })
  })
})
