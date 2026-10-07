/**
 * Pure Railway serviceCreate budget math. No Prisma / env side effects
 * besides optional env parsers (callers pass numbers in tests).
 *
 * Ground truth: rolling 24h UTC window over RailwayCreateLedger rows.
 * Railway's own cap can still reject when our ledger is empty (deleted
 * creates still count on their side) - that's the reactive hold.
 */

export const DEFAULT_RAILWAY_CREATE_DAILY_CAP = 25
export const DEFAULT_RAILWAY_CREATE_SAFETY_MARGIN = 2
export const CREATE_WINDOW_MS = 24 * 60 * 60 * 1000
export const QUOTA_HOLD_MIN_MS = 15 * 60 * 1000

/** Exact Railway GraphQL message from req_0d3c2zp4er0t (HWD canary). */
export const RAILWAY_CREATE_QUOTA_CANONICAL =
  "You've hit the service creation limit for new accounts (25 services per day). Contact us at station.railway.com to raise this."

export const RAILWAY_CREATE_QUOTA_WRAPPED = `Railway GraphQL error: ${RAILWAY_CREATE_QUOTA_CANONICAL}`

const QUOTA_NEEDLE = /service creation limit/i

export function isRailwayCreateQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return QUOTA_NEEDLE.test(message)
}

export function parseCreateDailyCap(raw: string | undefined = process.env.RAILWAY_CREATE_DAILY_CAP): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RAILWAY_CREATE_DAILY_CAP
}

export function parseSafetyMargin(
  raw: string | undefined = process.env.RAILWAY_CREATE_SAFETY_MARGIN,
): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_RAILWAY_CREATE_SAFETY_MARGIN
}

export function usableCreateBudget(cap: number, margin: number): number {
  return Math.max(0, cap - margin)
}

export function budget80Threshold(cap: number): number {
  return Math.ceil(cap * 0.8)
}

/** MUTATION: `>` instead of `>=` misses the exact 80% tick (20 of 25). */
export function shouldAlertCreateBudget80(rollingCount: number, cap: number): boolean {
  return rollingCount >= budget80Threshold(cap)
}

export function isCreateBudgetAllowed(args: {
  rollingCount: number
  usable: number
  quotaHoldUntil: Date | null
  now: Date
}): boolean {
  if (args.quotaHoldUntil && args.now.getTime() < args.quotaHoldUntil.getTime()) {
    return false
  }
  return args.rollingCount < args.usable
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/**
 * Oldest-first in-window timestamps. When over usable, expire enough of the
 * oldest rows that count becomes usable - 1 (room for one create).
 * createdAt == windowStart is OUT (exclusive gt window).
 */
export function nextLedgerRollOff(args: {
  createdAtsOldestFirst: Date[]
  usable: number
  now: Date
  windowMs?: number
}): Date | null {
  const windowMs = args.windowMs ?? CREATE_WINDOW_MS
  const windowStartMs = args.now.getTime() - windowMs
  const inWindow = args.createdAtsOldestFirst.filter((d) => d.getTime() > windowStartMs)
  const mustExpire = inWindow.length - args.usable + 1
  if (mustExpire <= 0) return null
  const target = inWindow[mustExpire - 1]
  if (!target) return null
  return new Date(target.getTime() + windowMs)
}

export function computeQueueEta(args: {
  createdAtsOldestFirst: Date[]
  usable: number
  now: Date
  quotaHoldUntil: Date | null
}): Date {
  const rollOff = nextLedgerRollOff({
    createdAtsOldestFirst: args.createdAtsOldestFirst,
    usable: args.usable,
    now: args.now,
  })
  const candidates: Date[] = []
  if (rollOff) candidates.push(rollOff)
  if (args.quotaHoldUntil && args.quotaHoldUntil.getTime() > args.now.getTime()) {
    candidates.push(args.quotaHoldUntil)
  }
  if (candidates.length === 0) {
    // Ledger empty / under usable but we are still queuing (Railway hold with
    // no timestamp yet) - next UTC day is the conservative floor.
    return nextUtcMidnight(args.now)
  }
  return new Date(Math.max(...candidates.map((d) => d.getTime())))
}

/**
 * After Railway rejects a create: hold at least 15m so the every-5-minute
 * drain cannot hammer an empty ledger, and at least until the next ledger
 * roll-off when we know our own window is full.
 */
export function quotaHoldUntilFromRejection(args: {
  createdAtsOldestFirst: Date[]
  usable: number
  now: Date
}): Date {
  const minHold = new Date(args.now.getTime() + QUOTA_HOLD_MIN_MS)
  const rollOff = nextLedgerRollOff({
    createdAtsOldestFirst: args.createdAtsOldestFirst,
    usable: args.usable,
    now: args.now,
  })
  const holdMs = Math.max(minHold.getTime(), rollOff?.getTime() ?? 0)
  return new Date(holdMs)
}

export function formatQueueEta(etaAt: Date, now: Date = new Date()): string {
  const ms = etaAt.getTime() - now.getTime()
  if (ms <= 0) return "soon"
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${etaAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export function queuedUserMessage(etaAt: Date, now: Date = new Date()): string {
  return `High demand - your claw is queued to provision, ~${formatQueueEta(etaAt, now)}. We'll notify you.`
}

export type QueueReason = "budget" | "railway_quota" | "resubscribe"

export type CreateBudgetSnapshot = {
  cap: number
  margin: number
  usable: number
  rollingCount: number
  quotaHoldUntil: Date | null
  allowed: boolean
  etaAt: Date
}
