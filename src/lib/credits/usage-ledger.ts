/**
 * Usage page ledger: daily / by-model must come from CreditUsageRecord,
 * not CreditUsageDaily.
 *
 * Gap: aggregate-credit-usage only rolls up days strictly before UTC today
 * (`createdAt < startOfDayUTC(now - 1d)`). Today's live rows stay in
 * CreditUsageRecord. GET /api/credits/usage used to read CreditUsageDaily
 * (take: 30 rows, not 30 days) - so a credits account with only-today
 * calls showed Recent activity and empty Daily / By model.
 *
 * MUTATION: restore yesterday-exclusive window or CreditUsageDaily-only
 * read → usage-ledger tests fail.
 */

export const USAGE_DAILY_WINDOW_DAYS = 30

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Inclusive UTC window: today plus the previous 29 days. */
export function usageWindowStart(now = new Date()): Date {
  const start = startOfUtcDay(now)
  start.setUTCDate(start.getUTCDate() - (USAGE_DAILY_WINDOW_DAYS - 1))
  return start
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export type UsageLedgerRecord = {
  workspaceId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costCents: number
  createdAt: Date | string
}

export type UsageDailyRow = {
  id: string
  creditAccountId: string
  workspaceId: string
  date: string
  provider: string
  model: string
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostCents: number
}

export function buildDailyFromRecords(
  records: readonly UsageLedgerRecord[],
  creditAccountId: string,
  now = new Date(),
): UsageDailyRow[] {
  const from = usageWindowStart(now)
  const buckets = new Map<string, UsageDailyRow>()

  for (const r of records) {
    const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
    if (Number.isNaN(created.getTime()) || created < from) continue
    const dateKey = utcDateKey(created)
    const key = `${dateKey}|${r.workspaceId}|${r.provider}|${r.model}`
    const prev = buckets.get(key)
    if (prev) {
      prev.totalCalls += 1
      prev.totalInputTokens += r.inputTokens
      prev.totalOutputTokens += r.outputTokens
      prev.totalCostCents += r.costCents
      continue
    }
    buckets.set(key, {
      id: `live:${key}`,
      creditAccountId,
      workspaceId: r.workspaceId,
      date: `${dateKey}T00:00:00.000Z`,
      provider: r.provider,
      model: r.model,
      totalCalls: 1,
      totalInputTokens: r.inputTokens,
      totalOutputTokens: r.outputTokens,
      totalCostCents: r.costCents,
    })
  }

  return Array.from(buckets.values()).sort((a, b) => b.date.localeCompare(a.date))
}
