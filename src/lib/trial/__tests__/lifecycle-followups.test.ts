import { describe, expect, it } from "vitest"
import {
  ACCOUNT_DELETION_GRACE_MS,
  ON_HOLD_CAP_MS,
  TRIAL_WINBACK_AFTER_MS,
  WORKSPACE_HARD_DELETE_MS,
  accountDeletionDue,
  accountDeletionPurgeAt,
  onHoldCapDue,
  trialWinbackDue,
  workspaceHardDeleteDue,
} from "@/lib/trial/lifecycle-followups"

const NOW = new Date("2026-10-07T06:00:00.000Z")

describe("on_hold 14-day cap", () => {
  it("day 13 is still grace", () => {
    const since = new Date(NOW.getTime() - 13 * 24 * 60 * 60 * 1000)
    expect(onHoldCapDue(since, NOW)).toBe(false)
  })

  it("day 14 is terminal (canary held since Sep 9 is due on Sep 23)", () => {
    const since = new Date("2026-09-09T08:28:42.249Z")
    const capDay = new Date(since.getTime() + ON_HOLD_CAP_MS)
    expect(capDay.toISOString().slice(0, 10)).toBe("2026-09-23")
    expect(onHoldCapDue(since, NOW)).toBe(true)
  })

  it("null stamp is not due (caller backfills before the cap)", () => {
    expect(onHoldCapDue(null, NOW)).toBe(false)
  })
})

describe("trial day-7 win-back", () => {
  it("is due 7 days after trialEndsAt when unsubscribed and unsent", () => {
    expect(
      trialWinbackDue({
        trialUsed: true,
        trialEndsAt: new Date(NOW.getTime() - TRIAL_WINBACK_AFTER_MS),
        trialWinbackSentAt: null,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        now: NOW,
      }),
    ).toBe(true)
  })

  it("skips on_hold, active subscribers, and a prior send", () => {
    const base = {
      trialUsed: true,
      trialEndsAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
      trialWinbackSentAt: null,
      hasActiveSubscription: false,
      subscriptionStatus: "on_hold" as string | null,
      now: NOW,
    }
    expect(trialWinbackDue(base)).toBe(false)
    expect(trialWinbackDue({ ...base, subscriptionStatus: null, hasActiveSubscription: true })).toBe(false)
    expect(
      trialWinbackDue({
        ...base,
        subscriptionStatus: null,
        trialWinbackSentAt: NOW,
      }),
    ).toBe(false)
  })
})

describe("deletion clocks", () => {
  it("account purge is request + 14 days", () => {
    const requested = new Date("2026-10-01T00:00:00.000Z")
    expect(accountDeletionPurgeAt(requested).toISOString()).toBe("2026-10-15T00:00:00.000Z")
    expect(accountDeletionDue(requested, new Date("2026-10-14T00:00:00.000Z"))).toBe(false)
    expect(accountDeletionDue(requested, new Date("2026-10-15T00:00:00.000Z"))).toBe(true)
    expect(ACCOUNT_DELETION_GRACE_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })

  it("workspace hard-delete is canceledAt + 90 days, not the 37-day resumable stamp", () => {
    const canceled = new Date("2026-07-01T00:00:00.000Z")
    expect(workspaceHardDeleteDue(canceled, new Date("2026-09-28T00:00:00.000Z"))).toBe(false)
    expect(workspaceHardDeleteDue(canceled, new Date("2026-09-29T00:00:00.000Z"))).toBe(true)
    expect(WORKSPACE_HARD_DELETE_MS).toBe(90 * 24 * 60 * 60 * 1000)
    expect(workspaceHardDeleteDue(null, NOW)).toBe(false)
  })
})
