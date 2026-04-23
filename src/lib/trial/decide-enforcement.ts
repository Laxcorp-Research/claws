/**
 * Pure logic for the trial-expiry enforcement cron.
 *
 * The caller (src/app/api/cron/enforce-trial-expiry/route.ts) is responsible
 * for the Prisma query that already applies the expiry filter:
 *   trialUsed = true AND trialEndsAt < now AND hasActiveSubscription = false
 * and includes each user's workspaces where status = 'RUNNING'.
 *
 * This module's job is to flatten that user->workspaces shape into a flat
 * list of per-workspace stop actions. It also serves as a defense-in-depth
 * layer: if a test fixture or some future caller passes in a row that the
 * query filter would have excluded, the same predicate is re-applied here.
 *
 * No Prisma imports at runtime (the type import below is erased at compile
 * time). No side effects. Given the same input, always returns the same
 * output.
 */

import type { WorkspaceStatus } from "@/generated/prisma/client"

export type UserWithWorkspaces = {
  id: string
  trialUsed: boolean
  trialEndsAt: Date | null
  hasActiveSubscription: boolean
  workspaces: Array<{
    id: string
    status: WorkspaceStatus | string
    containerId: string | null
  }>
}

export type StopAction = {
  userId: string
  workspaceId: string
  containerId: string | null
}

export type EnforcementPlan = {
  toStop: StopAction[]
}

/**
 * A user qualifies for enforcement if:
 *   - trialUsed is true
 *   - hasActiveSubscription is false
 *   - trialEndsAt < now, OR trialEndsAt is null
 *
 * The null-trialEndsAt branch matches the behavior of checkDeployEligibility
 * in src/lib/dodo-payments.ts: a trialUsed=true row with null trialEndsAt
 * is treated as expired. Shouldn't happen in the happy path (the only writer
 * of trialUsed sets trialEndsAt in the same transaction — see
 * src/app/api/deploy/[workspaceId]/cloud/route.ts), but we guard for it here
 * since the same guard exists on the deploy-gating side.
 *
 * For each qualifying user, every workspace with status = 'RUNNING' produces
 * one StopAction. Workspaces in any other status are ignored; they will be
 * picked up on the next cron run if/when they return to RUNNING.
 */
export function decideEnforcementActions(
  users: UserWithWorkspaces[],
  now: Date,
): EnforcementPlan {
  const toStop: StopAction[] = []

  for (const user of users) {
    if (!user.trialUsed) continue
    if (user.hasActiveSubscription) continue

    const isExpired = !user.trialEndsAt || user.trialEndsAt < now
    if (!isExpired) continue

    for (const workspace of user.workspaces) {
      if (workspace.status !== "RUNNING") continue
      toStop.push({
        userId: user.id,
        workspaceId: workspace.id,
        containerId: workspace.containerId,
      })
    }
  }

  return { toStop }
}
