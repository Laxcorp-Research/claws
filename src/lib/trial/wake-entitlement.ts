/**
 * Wake entitlement - same truth as deploy eligibility.
 * Expired+ungrated / unsubscribed claws must not resurrect via any wake path.
 */

import { isEntitled } from "@/lib/entitlement"
import { checkDeployEligibility, type DeployEligibilityUser } from "@/lib/dodo-payments"

export type WakeEntitlementUser = DeployEligibilityUser

export type WakeEntitlementResult = {
  allowed: boolean
  reason: string
  needsSubscription: boolean
  warning?: "update_card"
}

/**
 * Trial still active OR subscribed (identical to checkDeployEligibility.canDeploy).
 * on_hold is grace + warning, never silent subscribed.
 * MUTATION: inventing a second rule set → deploy vs wake drift.
 */
export function canWakeHibernatedWorkspace(
  user: WakeEntitlementUser,
): WakeEntitlementResult {
  const e = checkDeployEligibility(user)
  return {
    allowed: isEntitled("hibernation_wake", e.canDeploy),
    reason: e.reason,
    needsSubscription: e.needsSubscription,
    warning: e.warning,
  }
}

/** Locked Telegram copy when wake is entitlement-denied. */
export const WAKE_ON_CHANNEL_ENTITLEMENT_DENIED =
  "Your trial has ended - subscribe in the dashboard to wake this Claw."
