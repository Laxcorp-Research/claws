import { getModelCost } from "@/lib/models"

/** Sanity cap for a single ActivityLog.apiCost write from container usage. */
export const MAX_API_COST_PER_EVENT = 50

export type CostRange = "today" | "7d" | "all"

function roundCost(n: number): number {
  // Token costs are often sub-cent; keep microdollar precision.
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * UTC midnight for the calendar day containing `now` (rule 18 — no local Date parsing).
 * MUTATION: use `new Date(y, m, d)` local constructor → UTC boundary tests fail.
 */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
}

export function parseCostRange(value: string | null | undefined): CostRange {
  if (value === "7d" || value === "all" || value === "today") return value
  return "today"
}

/** Inclusive lower bound for a cost window, or null for "all". */
export function sinceForCostRange(range: CostRange, now = new Date()): Date | null {
  if (range === "all") return null
  if (range === "today") return utcDayStart(now)
  return new Date(now.getTime() - 7 * 86_400_000)
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
 * Single aggregation core for today-chip + costRange windows (Rider-1 honesty).
 * MESSAGE_SENT rows carry apiCost; TASK_COMPLETE drives call count + estimate fallback.
 * MUTATION: accept non-MESSAGE_SENT as cost constituents → route tests fail.
 */
export function aggregateAgentCostRow(input: {
  model: string
  taskCompleteCalls: number
  messageSents: ReadonlyArray<{ apiCost?: number | null }>
}): { calls: number; cost: number; isEstimate: boolean } {
  const calls = input.taskCompleteCalls
  const estimatedFallback = calls * (getModelCost(input.model) ?? 0)

  if (input.messageSents.length > 0) {
    const resolved = resolveWindowCost(input.messageSents, estimatedFallback)
    return { calls, cost: resolved.cost, isEstimate: resolved.isEstimate }
  }

  if (calls === 0) {
    return { calls: 0, cost: 0, isEstimate: false }
  }

  return { calls, cost: roundCost(estimatedFallback), isEstimate: true }
}

/**
 * Cost window for one agent from an in-memory activity page (legacy / unit path).
 * Server path uses aggregateAgentCostRow after SQL-windowed MESSAGE_SENT / TASK_COMPLETE.
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
  return aggregateAgentCostRow({
    model: args.model,
    taskCompleteCalls: taskCompletes.length,
    messageSents,
  })
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
