import { afterEach, describe, expect, it } from "vitest"
import { ENTITLEMENT_GATES, isEntitled } from "@/lib/entitlement"
import { checkDeployEligibility } from "@/lib/dodo-payments"
import { canWakeHibernatedWorkspace } from "@/lib/trial/wake-entitlement"
import { shouldSkipTrialStop } from "@/lib/trial/decide-trial-expiry"

const expired = {
  trialUsed: true,
  trialStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  hasActiveSubscription: false,
  subscriptionStatus: null,
}

describe("isEntitled", () => {
  afterEach(() => {
    delete process.env.CLAWS_PROFILE
  })

  it("self-host allows subscription_required, trial_expired, on_hold, deploy_limit, hibernation wake, and the scheduler", () => {
    process.env.CLAWS_PROFILE = "self-host"
    for (const gate of ENTITLEMENT_GATES) {
      expect(isEntitled(gate, false)).toBe(true)
    }
    const deploy = checkDeployEligibility(expired)
    expect(deploy.canDeploy).toBe(true)
    expect(deploy.reason).toBe("self_host")
    expect(deploy.isFirstDeploy).toBe(false)
    expect(canWakeHibernatedWorkspace(expired).allowed).toBe(true)
    expect(
      shouldSkipTrialStop({ hasActiveSubscription: false, subscriptionStatus: null }),
    ).toBe(true)
  })

  it("hosted expired trial stays subscription_required and the scheduler still stops", () => {
    delete process.env.CLAWS_PROFILE
    expect(isEntitled("subscription_required", false)).toBe(false)
    expect(isEntitled("deploy_limit", false)).toBe(false)
    const deploy = checkDeployEligibility(expired)
    expect(deploy.canDeploy).toBe(false)
    expect(deploy.reason).toBe("subscription_required")
    expect(canWakeHibernatedWorkspace(expired).allowed).toBe(false)
    expect(
      shouldSkipTrialStop({ hasActiveSubscription: false, subscriptionStatus: null }),
    ).toBe(false)
    expect(
      shouldSkipTrialStop({ hasActiveSubscription: false, subscriptionStatus: "on_hold" }),
    ).toBe(true)
  })
})
