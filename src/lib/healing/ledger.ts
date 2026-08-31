import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import type { HealConditionId } from "@/lib/healing/conditions"

export const HEAL_ATTEMPT_EVENT_KIND = "heal_attempt"

export type HealOutcome = "healed" | "failed" | "skipped" | "cleared" | "exhausted" | "blocked"

export async function ledgerHealAttempt(args: {
  workspaceId: string
  condition: HealConditionId
  outcome: HealOutcome
  detail?: string | null
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: `Heal ${args.condition}: ${args.outcome}`,
        detail: args.detail ?? null,
        actionType: "SYSTEM",
        timestamp: new Date(),
        metadata: JSON.stringify({
          eventKind: HEAL_ATTEMPT_EVENT_KIND,
          condition: args.condition,
          outcome: args.outcome,
        }),
      },
    })
  } catch (err) {
    log.error("heal-ledger: failed to write attempt", {
      workspaceId: args.workspaceId,
      condition: args.condition,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
