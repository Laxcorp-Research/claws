import { isSelfHost } from "@/lib/profile"

/**
 * Every billing gate. Self-host is allowed before the hosted decision runs.
 * Callers pass the hosted boolean and do not branch on CLAWS_PROFILE.
 */
export const ENTITLEMENT_GATES = [
  "subscription_required",
  "trial_expired",
  "on_hold",
  "deploy_limit",
  "hibernation_wake",
  "scheduler",
] as const

export type EntitlementGate = (typeof ENTITLEMENT_GATES)[number]

export function isEntitled(gate: EntitlementGate, hostedAllowed: boolean): boolean {
  void gate
  if (isSelfHost()) return true
  return hostedAllowed
}
