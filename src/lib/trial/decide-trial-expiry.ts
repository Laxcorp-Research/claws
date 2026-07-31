/**
 * Pure GRACE-24 trial-expiry planning.
 *
 * Grace anchors on trialExpiryNotifiedAt (notification time), NEVER on
 * trialEndsAt. Retroactive first run: expired days ago + never notified →
 * notify now; stop only after notify+24h.
 *
 * Stop enforces entitlement, not container liveness: any non-terminal
 * workspace (RUNNING, HIBERNATED, WAKING, …) is stopped. HIBERNATED uses
 * status-flip only (no container op); others use syncThenDestroy.
 *
 * No Prisma imports at runtime. No side effects.
 */

export const TRIAL_EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000

/** Already terminal / never-runtime — skip stop enforcement. */
export const TRIAL_STOP_TERMINAL_STATUSES = [
  "STOPPED",
  "DRAFT",
  "SETUP_INCOMPLETE",
] as const

export type TrialStopTerminalStatus = (typeof TRIAL_STOP_TERMINAL_STATUSES)[number]

export type TrialStopEnforceMode = "destroy_container" | "status_flip"

export type TrialExpiryUser = {
  id: string
  email: string
  name: string | null
  trialUsed: boolean
  trialEndsAt: Date | null
  trialExpiryNotifiedAt: Date | null
  hasActiveSubscription: boolean
  /** Dodo lifecycle: active | on_hold | cancelled | failed | expired */
  subscriptionStatus: string | null
  workspaces: Array<{
    id: string
    name: string
    status: string
  }>
}

export type NotifyAction = {
  kind: "notify"
  userId: string
  email: string
  name: string | null
  clawNames: string[]
  /** Workspace ids to ledger trial_expiry_notify (one ActivityLog row each). */
  workspaceIds: string[]
}

export type StopAction = {
  kind: "stop"
  userId: string
  email: string
  name: string | null
  workspaceId: string
  workspaceName: string
  /** HIBERNATED → status flip only; else syncThenDestroy. */
  enforceMode: TrialStopEnforceMode
}

export type TrialExpiryPlan = {
  toNotify: NotifyAction[]
  toStop: StopAction[]
}

/** True when Dodo reports dunning / on_hold — never stop these users. */
export function isSubscriptionOnHold(
  user: Pick<TrialExpiryUser, "subscriptionStatus" | "hasActiveSubscription">,
): boolean {
  return user.subscriptionStatus === "on_hold"
}

/**
 * Pre-stop gate. Skip when subscribed OR in dunning (on_hold).
 * MUTATION: drop on_hold check → on_hold fixture is stopped.
 */
export function shouldSkipTrialStop(
  user: Pick<TrialExpiryUser, "hasActiveSubscription" | "subscriptionStatus">,
): boolean {
  if (user.hasActiveSubscription) return true
  if (isSubscriptionOnHold(user)) return true
  return false
}

export function isTrialStopEnforceableStatus(status: string): boolean {
  return !(TRIAL_STOP_TERMINAL_STATUSES as readonly string[]).includes(status)
}

/**
 * HIBERNATED has no live container — flip to STOPPED only.
 * Everything else may have a container → syncThenDestroy.
 */
export function trialStopEnforceMode(status: string): TrialStopEnforceMode {
  return status === "HIBERNATED" ? "status_flip" : "destroy_container"
}

function isTrialExpired(
  user: Pick<TrialExpiryUser, "trialUsed" | "trialEndsAt">,
  now: Date,
): boolean {
  if (!user.trialUsed) return false
  // null trialEndsAt + trialUsed ≡ expired (matches checkDeployEligibility)
  if (!user.trialEndsAt) return true
  return user.trialEndsAt < now
}

/**
 * Plan notify + stop actions for a batch of candidate users.
 * Caller may pre-filter; predicates are re-applied defense-in-depth.
 */
export function decideTrialExpiryActions(
  users: TrialExpiryUser[],
  now: Date,
  graceMs: number = TRIAL_EXPIRY_GRACE_MS,
): TrialExpiryPlan {
  const toNotify: NotifyAction[] = []
  const toStop: StopAction[] = []
  const stopCutoff = new Date(now.getTime() - graceMs)

  for (const user of users) {
    if (!isTrialExpired(user, now)) continue
    if (user.hasActiveSubscription) continue
    // Dunning users stay out of both phases even if hasActiveSubscription
    // was incorrectly cleared (subscription.failed race).
    if (isSubscriptionOnHold(user)) continue

    if (user.trialExpiryNotifiedAt === null) {
      const running = user.workspaces.filter((w) => w.status === "RUNNING")
      const ledgerWorkspaces = running.length > 0 ? running : user.workspaces
      // Still notify even with zero RUNNING claws (honesty + ledger stamp).
      toNotify.push({
        kind: "notify",
        userId: user.id,
        email: user.email,
        name: user.name,
        clawNames: ledgerWorkspaces.map((w) => w.name),
        workspaceIds: ledgerWorkspaces.map((w) => w.id),
      })
      continue
    }

    if (user.trialExpiryNotifiedAt < stopCutoff) {
      for (const workspace of user.workspaces) {
        if (!isTrialStopEnforceableStatus(workspace.status)) continue
        toStop.push({
          kind: "stop",
          userId: user.id,
          email: user.email,
          name: user.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          enforceMode: trialStopEnforceMode(workspace.status),
        })
      }
    }
  }

  return { toNotify, toStop }
}
