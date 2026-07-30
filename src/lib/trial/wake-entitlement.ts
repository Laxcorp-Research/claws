/**
 * Wake entitlement — same truth as deploy eligibility.
 * Expired+ungrated / unsubscribed claws must not resurrect via any wake path.
 */

import { checkDeployEligibility } from "@/lib/dodo-payments"

export type WakeEntitlementUser = {
  trialUsed: boolean
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  hasActiveSubscription: boolean
}

export type WakeEntitlementResult = {
  allowed: boolean
  reason: string
  needsSubscription: boolean
}

/**
 * Trial still active OR subscribed (identical to checkDeployEligibility.canDeploy).
 * MUTATION: inventing a second rule set → deploy vs wake drift.
 */
export function canWakeHibernatedWorkspace(
  user: WakeEntitlementUser,
): WakeEntitlementResult {
  const e = checkDeployEligibility(user)
  return {
    allowed: e.canDeploy,
    reason: e.reason,
    needsSubscription: e.needsSubscription,
  }
}

/** Locked Telegram copy when wake is entitlement-denied. */
export const WAKE_ON_CHANNEL_ENTITLEMENT_DENIED =
  "Your trial has ended — subscribe in the dashboard to wake this Claw."
