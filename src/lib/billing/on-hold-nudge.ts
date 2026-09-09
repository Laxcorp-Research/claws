/**
 * Dunning watchtower. Webhook on_hold nudges at event time; owners already
 * on_hold (silent subscribed) need a health-monitor pass.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge"

export async function nudgeOnHoldOwners(): Promise<{ nudged: number }> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      user: { subscriptionStatus: "on_hold" },
      status: { notIn: ["DRAFT", "SETUP_INCOMPLETE"] },
    },
    select: { id: true },
  })

  let nudged = 0
  for (const ws of workspaces) {
    try {
      const result = await sendCustomerNudge({
        workspaceId: ws.id,
        condition: "subscription-on-hold",
      })
      if (result.sent) nudged++
    } catch (err) {
      log.warn("on-hold nudge failed", {
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { nudged }
}
