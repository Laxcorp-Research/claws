import { getModelCost } from "@/lib/models"

/** Sanity cap for a single ActivityLog.apiCost write from container usage. */
export const MAX_API_COST_PER_EVENT = 50

function roundCost(n: number): number {
  // Token costs are often sub-cent; keep microdollar precision.
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * Resolve a display cost for a window of activity rows.
 *
 * - All constituent rows have finite apiCost ≥ 0 → sum them (real; not an estimate).
 * - Otherwise → `estimatedFallback` from models.ts pricing (still labeled "est.").
 * - Partial-real windows are estimates (do not blend real + priced silently).
 */
export function resolveWindowCost(
  constituentRows: ReadonlyArray<{ apiCost?: number | null }>,
  estimatedFallback: number,
): { cost: number; isEstimate: boolean } {
  if (constituentRows.length === 0) {
    return { cost: 0, isEstimate: false }
  }

  const allReal = constituentRows.every((row) => {
    const c = row.apiCost
    return typeof c === "number" && Number.isFinite(c) && c >= 0
  })

  if (allReal) {
    const cost = constituentRows.reduce((sum, row) => sum + (row.apiCost as number), 0)
    return { cost: roundCost(cost), isEstimate: false }
  }

  return {
    cost: roundCost(estimatedFallback),
    isEstimate: true,
  }
}

/**
 * Cost window for one agent: MESSAGE_SENT rows are the costTotal carriers;
 * TASK_COMPLETE still drives the call count (and the models.ts estimate).
 */
export function resolveAgentCostWindow(args: {
  rows: ReadonlyArray<{
    agentSlug?: string | null
    actionType: string
    timestamp: string
    apiCost?: number | null
  }>
  agentSlug: string
  model: string
  sinceMs: number
}): { calls: number; cost: number; isEstimate: boolean } {
  const inWindow = args.rows.filter(
    (row) =>
      row.agentSlug === args.agentSlug &&
      Date.parse(row.timestamp) >= args.sinceMs,
  )
  const taskCompletes = inWindow.filter((row) => row.actionType === "TASK_COMPLETE")
  const messageSents = inWindow.filter((row) => row.actionType === "MESSAGE_SENT")
  const calls = taskCompletes.length
  const estimatedFallback = calls * getModelCost(args.model)

  // Prefer MESSAGE_SENT as constituents when any exist (where costTotal lands).
  // Fall back to TASK_COMPLETE-only estimate when there are no MESSAGE_SENT rows.
  if (messageSents.length > 0) {
    const resolved = resolveWindowCost(messageSents, estimatedFallback)
    return { calls, cost: resolved.cost, isEstimate: resolved.isEstimate }
  }

  if (calls === 0) {
    return { calls: 0, cost: 0, isEstimate: false }
  }

  return { calls, cost: estimatedFallback, isEstimate: true }
}

/** Format a cost for StatChip / table cells. Zero-activity windows stay "—". */
export function formatCostDisplay(
  cost: number,
  opts: { isEstimate: boolean; hasActivity: boolean; formatCurrency: (n: number) => string },
): string {
  if (!opts.hasActivity) return "—"
  const formatted = opts.formatCurrency(cost)
  return opts.isEstimate ? `~${formatted} est.` : formatted
}
