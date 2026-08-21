/**
 * PR-6: template purchase refund workspace teardown policy.
 *
 * Workspace may be deleted only when BOTH:
 *   1. purchase age ≤ 7 days (UTC calendar days via ms/86400000 floor)
 *   2. never-deployed - no Deployment with status COMPLETED or SUPERSEDED
 *
 * Outside that window, or if ever successfully deployed: keep workspace,
 * still mark Purchase REFUNDED, ledger a note.
 */

export const REFUND_WORKSPACE_DELETE_WINDOW_DAYS = 7

/** Successful deploy evidence - ever completed (incl. later superseded). */
export const DEPLOYED_EVIDENCE_STATUSES = ["COMPLETED", "SUPERSEDED"] as const

export type RefundWorkspaceDecision =
  | { deleteWorkspace: true; reason: "within_window_and_never_deployed" }
  | {
      deleteWorkspace: false
      reason: "outside_window" | "already_deployed" | "outside_window_and_deployed" | "no_workspace"
    }

export function daysSincePurchase(purchaseCreatedAt: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - purchaseCreatedAt.getTime()) / 86_400_000)
}

export function decideRefundWorkspaceAction(args: {
  hasWorkspace: boolean
  purchaseCreatedAt: Date
  /** True when a COMPLETED or SUPERSEDED Deployment exists for the workspace. */
  hasSuccessfulDeploy: boolean
  now?: Date
}): RefundWorkspaceDecision {
  if (!args.hasWorkspace) {
    return { deleteWorkspace: false, reason: "no_workspace" }
  }

  const days = daysSincePurchase(args.purchaseCreatedAt, args.now ?? new Date())
  const withinWindow = days <= REFUND_WORKSPACE_DELETE_WINDOW_DAYS
  const neverDeployed = !args.hasSuccessfulDeploy

  if (withinWindow && neverDeployed) {
    return { deleteWorkspace: true, reason: "within_window_and_never_deployed" }
  }
  if (!withinWindow && !neverDeployed) {
    return { deleteWorkspace: false, reason: "outside_window_and_deployed" }
  }
  if (!withinWindow) {
    return { deleteWorkspace: false, reason: "outside_window" }
  }
  return { deleteWorkspace: false, reason: "already_deployed" }
}
