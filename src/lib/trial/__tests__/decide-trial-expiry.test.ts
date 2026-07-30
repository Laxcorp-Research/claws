import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  decideTrialExpiryActions,
  shouldSkipTrialStop,
  TRIAL_EXPIRY_GRACE_MS,
  type TrialExpiryUser,
} from "@/lib/trial/decide-trial-expiry"

const NOW = new Date("2026-07-28T12:00:00.000Z")
const DAYS_AGO = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
const HOURS_AGO = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000)

function makeUser(overrides: Partial<TrialExpiryUser> = {}): TrialExpiryUser {
  return {
    id: "user-1",
    email: "u@example.com",
    name: "User",
    trialUsed: true,
    trialEndsAt: DAYS_AGO(3),
    trialExpiryNotifiedAt: null,
    hasActiveSubscription: false,
    subscriptionStatus: null,
    workspaces: [
      { id: "ws-1", name: "Growth Machine", status: "RUNNING" },
    ],
    ...overrides,
  }
}

describe("decideTrialExpiryActions (GRACE-24)", () => {
  it("retroactive first-run: expired days ago, never notified → notify now (grace on notify, not trialEndsAt)", () => {
    const plan = decideTrialExpiryActions(
      [
        makeUser({
          trialEndsAt: DAYS_AGO(5),
          trialExpiryNotifiedAt: null,
        }),
      ],
      NOW,
    )
    expect(plan.toNotify).toHaveLength(1)
    expect(plan.toNotify[0].clawNames).toEqual(["Growth Machine"])
    expect(plan.toNotify[0].workspaceIds).toEqual(["ws-1"])
    expect(plan.toStop).toHaveLength(0)
  })

  it("notify idempotency: already stamped → no second notify", () => {
    const plan = decideTrialExpiryActions(
      [
        makeUser({
          trialExpiryNotifiedAt: HOURS_AGO(1),
        }),
      ],
      NOW,
    )
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.toStop).toHaveLength(0)
  })

  it("on_hold → neither notify nor stop", () => {
    const plan = decideTrialExpiryActions(
      [
        makeUser({
          hasActiveSubscription: false,
          subscriptionStatus: "on_hold",
          trialExpiryNotifiedAt: HOURS_AGO(48),
        }),
      ],
      NOW,
    )
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.toStop).toHaveLength(0)
  })

  it("resubscribe / active sub → never touched", () => {
    const plan = decideTrialExpiryActions(
      [
        makeUser({
          hasActiveSubscription: true,
          subscriptionStatus: "active",
          trialExpiryNotifiedAt: HOURS_AGO(48),
        }),
      ],
      NOW,
    )
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.toStop).toHaveLength(0)
  })

  it("notify+24h+no-sub → stop all non-terminal workspaces (RUNNING + HIBERNATED)", () => {
    const plan = decideTrialExpiryActions(
      [
        makeUser({
          trialExpiryNotifiedAt: new Date(NOW.getTime() - TRIAL_EXPIRY_GRACE_MS - 1000),
          workspaces: [
            { id: "ws-1", name: "A", status: "RUNNING" },
            { id: "ws-2", name: "B", status: "HIBERNATED" },
            { id: "ws-3", name: "C", status: "STOPPED" },
            { id: "ws-4", name: "D", status: "DRAFT" },
          ],
        }),
      ],
      NOW,
    )
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.toStop).toEqual([
      {
        kind: "stop",
        userId: "user-1",
        email: "u@example.com",
        name: "User",
        workspaceId: "ws-1",
        workspaceName: "A",
        enforceMode: "destroy_container",
      },
      {
        kind: "stop",
        userId: "user-1",
        email: "u@example.com",
        name: "User",
        workspaceId: "ws-2",
        workspaceName: "B",
        enforceMode: "status_flip",
      },
    ])
  })

  it("MUTATION: RUNNING-only stop would skip HIBERNATED (revenue hole)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/trial/decide-trial-expiry.ts"),
      "utf8",
    )
    expect(src).not.toMatch(/workspace\.status !== ["']RUNNING["']/)
    expect(src).toContain("isTrialStopEnforceableStatus")
    expect(src).toContain("status_flip")
  })

  it("inside grace (<24h after notify) → no stop yet", () => {
    const plan = decideTrialExpiryActions(
      [makeUser({ trialExpiryNotifiedAt: HOURS_AGO(12) })],
      NOW,
    )
    expect(plan.toStop).toHaveLength(0)
    expect(plan.toNotify).toHaveLength(0)
  })

  it("shouldSkipTrialStop: on_hold and subscribed", () => {
    expect(shouldSkipTrialStop({ hasActiveSubscription: true, subscriptionStatus: null })).toBe(
      true,
    )
    expect(
      shouldSkipTrialStop({ hasActiveSubscription: false, subscriptionStatus: "on_hold" }),
    ).toBe(true)
    expect(
      shouldSkipTrialStop({ hasActiveSubscription: false, subscriptionStatus: null }),
    ).toBe(false)
  })

  it("MUTATION: shouldSkipTrialStop must check on_hold (drop → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/trial/decide-trial-expiry.ts"),
      "utf8",
    )
    expect(src).toContain('subscriptionStatus === "on_hold"')
    expect(src).toMatch(/function shouldSkipTrialStop/)
    expect(src).toContain("isSubscriptionOnHold")
  })
})
