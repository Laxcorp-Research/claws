/**
 * Phase 0 follow-ups that sit beside GRACE-24.
 *
 * on_hold still skips the 24h trial stop (dunning keeps access). After 14
 * days the cap is terminal: stop + nudge, and deploy eligibility denies
 * until subscription.active clears the stamp.
 *
 * Day-7 win-back is a second email after trialEndsAt, not a second stop.
 */

export const ON_HOLD_CAP_MS = 14 * 24 * 60 * 60 * 1000
export const TRIAL_WINBACK_AFTER_MS = 7 * 24 * 60 * 60 * 1000
export const ACCOUNT_DELETION_GRACE_MS = 14 * 24 * 60 * 60 * 1000
export const WORKSPACE_HARD_DELETE_MS = 90 * 24 * 60 * 60 * 1000

export function onHoldCapDue(since: Date | null, now: Date): boolean {
  if (!since) return false
  return now.getTime() - since.getTime() >= ON_HOLD_CAP_MS
}

export function trialWinbackDue(args: {
  trialUsed: boolean
  trialEndsAt: Date | null
  trialWinbackSentAt: Date | null
  hasActiveSubscription: boolean
  subscriptionStatus: string | null
  now: Date
}): boolean {
  if (!args.trialUsed || !args.trialEndsAt) return false
  if (args.trialWinbackSentAt) return false
  if (args.hasActiveSubscription) return false
  if (args.subscriptionStatus === "on_hold") return false
  return args.now.getTime() - args.trialEndsAt.getTime() >= TRIAL_WINBACK_AFTER_MS
}

export function accountDeletionDue(requestedAt: Date | null, now: Date): boolean {
  if (!requestedAt) return false
  return now.getTime() - requestedAt.getTime() >= ACCOUNT_DELETION_GRACE_MS
}

export function accountDeletionPurgeAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_MS)
}

/** Hard-delete workspace rows 90 days after cancellation took effect. */
export function workspaceHardDeleteDue(canceledAt: Date | null, now: Date): boolean {
  if (!canceledAt) return false
  return now.getTime() - canceledAt.getTime() >= WORKSPACE_HARD_DELETE_MS
}
