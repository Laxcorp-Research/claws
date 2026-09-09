/**
 * ERROR API_KEY connections on HIBERNATED / idle claws never hit
 * connection-health (CONNECTED-only). Re-probe on deploy ledgers without
 * a user-only nudge. Sweep persisted ERROR rows.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge"
import { nudgeConditionForToolError } from "@/lib/tools/reprobe-on-deploy"

export async function nudgePersistedToolErrors(): Promise<{ nudged: number }> {
  const rows = await prisma.toolConnection.findMany({
    where: { connectionType: "API_KEY", status: "ERROR" },
    select: { workspaceId: true, toolSlug: true, lastError: true },
  })

  const conditionsByWorkspace = new Map<string, Set<"twitter-402-tier" | "tool-connection-error">>()
  for (const row of rows) {
    const condition = nudgeConditionForToolError({
      toolSlug: row.toolSlug,
      error: row.lastError,
    })
    const set = conditionsByWorkspace.get(row.workspaceId) ?? new Set()
    set.add(condition)
    conditionsByWorkspace.set(row.workspaceId, set)
  }

  let nudged = 0
  for (const [workspaceId, conditions] of conditionsByWorkspace) {
    for (const condition of conditions) {
      try {
        const result = await sendCustomerNudge({ workspaceId, condition })
        if (result.sent) nudged++
      } catch (err) {
        log.warn("tool-error nudge failed", {
          workspaceId,
          condition,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return { nudged }
}
