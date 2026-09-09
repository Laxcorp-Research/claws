import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  canWakeHibernatedWorkspace,
  WAKE_ON_CHANNEL_ENTITLEMENT_DENIED,
} from "@/lib/trial/wake-entitlement"

const FUTURE = new Date("2099-01-01T00:00:00.000Z")
const PAST = new Date("2020-01-01T00:00:00.000Z")

describe("canWakeHibernatedWorkspace", () => {
  it("allows active trial", () => {
    expect(
      canWakeHibernatedWorkspace({
        trialUsed: true,
        trialStartedAt: PAST,
        trialEndsAt: FUTURE,
        hasActiveSubscription: false,
      }).allowed,
    ).toBe(true)
  })

  it("allows subscribed after trial", () => {
    expect(
      canWakeHibernatedWorkspace({
        trialUsed: true,
        trialStartedAt: PAST,
        trialEndsAt: PAST,
        hasActiveSubscription: true,
      }).allowed,
    ).toBe(true)
  })

  it("denies expired trial with no subscription", () => {
    const r = canWakeHibernatedWorkspace({
      trialUsed: true,
      trialStartedAt: PAST,
      trialEndsAt: PAST,
      hasActiveSubscription: false,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("subscription_required")
    expect(r.needsSubscription).toBe(true)
  })

  it("on_hold is grace with update_card warning, never silent subscribed", () => {
    const r = canWakeHibernatedWorkspace({
      trialUsed: true,
      trialStartedAt: PAST,
      trialEndsAt: PAST,
      hasActiveSubscription: true,
      subscriptionStatus: "on_hold",
    })
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe("subscription_on_hold")
    expect(r.warning).toBe("update_card")
    expect(r.reason).not.toBe("subscribed")
  })

  it("MUTATION: must delegate to checkDeployEligibility (single truth)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/trial/wake-entitlement.ts"),
      "utf8",
    )
    expect(src).toContain("checkDeployEligibility")
    expect(src).toContain("canDeploy")
  })

  it("MUTATION: wake paths must call canWakeHibernatedWorkspace", () => {
    const files = [
      "src/lib/hibernation/manager.ts",
      "src/lib/hibernation/wake-on-channel.ts",
      "src/app/api/dashboard/[workspaceId]/wake/route.ts",
      "src/app/api/cron/hibernation/route.ts",
    ]
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      expect(src, rel).toContain("canWakeHibernatedWorkspace")
    }
  })

  it("locked Telegram deny copy", () => {
    expect(WAKE_ON_CHANNEL_ENTITLEMENT_DENIED).toContain("trial has ended")
  })
})
