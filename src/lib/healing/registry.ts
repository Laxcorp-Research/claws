import {
  PHASE_A_CONDITION_IDS,
  type HealConditionId,
} from "@/lib/healing/conditions"

export type HealRuling = "platform" | "user-only" | "owner-only" | "deferred-b2" | "deferred-b3"
export type HealPlane = "customer" | "owner" | "none"
export type HealEscalation = "none" | "customer-alert" | "owner-alert" | "deferred-b2" | "deferred-b3"

export interface HealPolicy {
  id: HealConditionId
  ruling: HealRuling
  plane: HealPlane
  /** Existing function/cron to wire, not reimplement. */
  existingHeal: string | null
  retries: number
  escalate: HealEscalation
}

function policy(
  id: HealConditionId,
  ruling: HealRuling,
  plane: HealPlane,
  existingHeal: string | null,
  retries: number,
  escalate: HealEscalation,
): HealPolicy {
  return { id, ruling, plane, existingHeal, retries, escalate }
}

/**
 * One row per Phase-A condition plus mission_interrupted. B-3 wires
 * user-only channel nudges and spend-limit pause. Drift stays banner-only
 * on running claws.
 */
export const HEAL_REGISTRY: Record<HealConditionId, HealPolicy> = {
  "state-sync-stale": policy("state-sync-stale", "platform", "customer", "trySyncNow", 3, "customer-alert"),
  "fingerprint-config-drift": policy("fingerprint-config-drift", "platform", "none", "banner-only (never auto on running)", 0, "none"),
  "bad-token": policy("bad-token", "platform", "none", "auto-redeploy under guards", 3, "owner-alert"),
  "plugin-not-loaded": policy("plugin-not-loaded", "platform", "none", "auto-redeploy under guards", 3, "owner-alert"),
  "env-credential-drift": policy("env-credential-drift", "platform", "none", "healWorkspace", 0, "none"),
  "probe-failure": policy("probe-failure", "platform", "customer", "crash-restart under guards", 5, "owner-alert"),
  "error-self-heal": policy("error-self-heal", "platform", "none", "decideUpdate", 0, "none"),
  "probe-degraded": policy("probe-degraded", "platform", "none", "auto-redeploy under guards", 3, "owner-alert"),
  "heartbeat-missed-running": policy("heartbeat-missed-running", "platform", "customer", "re-arm then restart under guards", 3, "owner-alert"),
  "heartbeat-missed-wake": policy("heartbeat-missed-wake", "platform", "customer", "scheduleWake", 0, "customer-alert"),
  "heartbeat-woke-late": policy("heartbeat-woke-late", "platform", "customer", "re-arm then restart under guards", 3, "owner-alert"),
  "activity-silence": policy("activity-silence", "deferred-b2", "none", null, 0, "deferred-b2"),
  "hibernation-refused": policy("hibernation-refused", "platform", "none", "retry sync-now then hibernate", 2, "none"),
  "stuck-waking": policy("stuck-waking", "platform", "none", "hibernation cron stuck-WAKING retry", 0, "none"),
  "deploy-failed": policy("deploy-failed", "platform", "customer", "transient retry 2x", 2, "none"),
  "stranded-deployment": policy("stranded-deployment", "platform", "none", "adoptStrandedDeployments", 0, "none"),
  "provisioning-queued": policy("provisioning-queued", "platform", "none", "drainProvisioningQueueHead", 0, "none"),
  "railway-create-budget": policy("railway-create-budget", "owner-only", "owner", "sendOwnerAlert", 0, "owner-alert"),
  "keyless-boot": policy("keyless-boot", "platform", "none", "evaluateWorkspaceDeployProviderAuth", 0, "none"),
  "needs-credentials-tools": policy("needs-credentials-tools", "platform", "none", "evaluateWorkspaceDeployToolPrerequisites", 0, "none"),
  "mcp-session-dead": policy("mcp-session-dead", "platform", "customer", "auto-redeploy under guards", 3, "owner-alert"),
  "version-update": policy("version-update", "platform", "none", "apply at next wake", 0, "none"),
  "oauth-expired": policy("oauth-expired", "user-only", "customer", null, 0, "customer-alert"),
  "tool-connection-error": policy("tool-connection-error", "user-only", "customer", "connection-health retry", 2, "customer-alert"),
  "twitter-402-tier": policy("twitter-402-tier", "user-only", "customer", null, 0, "customer-alert"),
  "tool-429": policy("tool-429", "platform", "none", "agent/client backoff", 0, "deferred-b3"),
  "credits-exhausted": policy("credits-exhausted", "platform", "customer", "onCreditsExhausted", 0, "customer-alert"),
  "trial-lapse": policy("trial-lapse", "platform", "customer", "enforce-trial-expiry", 0, "customer-alert"),
  "subscription-failed": policy("subscription-failed", "platform", "customer", "handleSubscriptionFailed", 0, "customer-alert"),
  "subscription-on-hold": policy("subscription-on-hold", "user-only", "customer", null, 0, "customer-alert"),
  "payment-failed": policy("payment-failed", "user-only", "customer", null, 0, "customer-alert"),
  "spend-limit-100": policy("spend-limit-100", "platform", "customer", "enforceSpendLimit", 0, "customer-alert"),
  "credit-pool": policy("credit-pool", "owner-only", "owner", "credit-pool-monitor", 0, "owner-alert"),
  "credit-balance-drift": policy("credit-balance-drift", "owner-only", "owner", "reconcile-credit-balances", 0, "owner-alert"),
  "email-delivery-failed": policy("email-delivery-failed", "platform", "owner", "Resend retry (trial stamp)", 0, "owner-alert"),
  "channel-send-failed": policy("channel-send-failed", "platform", "owner", "telegram then email fallback", 0, "owner-alert"),
  "thinking-signature-poison": policy("thinking-signature-poison", "platform", "none", "auto-redeploy under guards", 3, "owner-alert"),
  "mission_interrupted": policy("mission_interrupted", "platform", "none", "auto-resume on wake", 2, "customer-alert"),
  "cron-job-failed": policy("cron-job-failed", "platform", "customer", "classify then heal", 0, "customer-alert"),
  "state-sync-near-cap": policy("state-sync-near-cap", "user-only", "customer", null, 0, "customer-alert"),
  "pending-approval-unactioned": policy(
    "pending-approval-unactioned",
    "user-only",
    "customer",
    "web-chat-only email after 4h",
    0,
    "customer-alert",
  ),
  "railway-domain-cap": policy(
    "railway-domain-cap",
    "platform",
    "owner",
    "prune+retry",
    1,
    "owner-alert",
  ),
}

export function getHealPolicy(id: HealConditionId): HealPolicy {
  return HEAL_REGISTRY[id]
}

export function listedConditionIds(): HealConditionId[] {
  return [...PHASE_A_CONDITION_IDS]
}

export function ownerOnlyConditionIds(): HealConditionId[] {
  return PHASE_A_CONDITION_IDS.filter((id) => HEAL_REGISTRY[id].ruling === "owner-only")
}

export function isOwnerOnlyCondition(id: string): boolean {
  return (PHASE_A_CONDITION_IDS as readonly string[]).includes(id)
    && HEAL_REGISTRY[id as HealConditionId].ruling === "owner-only"
}
