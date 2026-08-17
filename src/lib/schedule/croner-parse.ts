/**
 * The ONLY module that may import `croner`.
 * MUTATION: substitute cron-parser / a lookalike here → parity tests fail.
 */
import { Cron } from "croner"

export const CRONER_FIVE_FIELD = {
  paused: true,
  unref: true,
  mode: "5-part" as const,
  legacyMode: true,
}

export function isFiveFieldCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p) => p.length > 0)
}

export function parseCroner(
  expr: string,
  timezone?: string | null,
): Cron {
  if (!isFiveFieldCron(expr)) {
    throw new Error("Cron must be 5 fields (min hour day-of-month month day-of-week)")
  }
  const tz = timezone && timezone.trim().length > 0 ? timezone.trim() : undefined
  return new Cron(expr.trim(), {
    ...CRONER_FIVE_FIELD,
    ...(tz ? { timezone: tz } : {}),
  })
}

export function nextRunsCroner(
  expr: string,
  n: number,
  from: Date,
  timezone?: string | null,
): Date[] {
  const job = parseCroner(expr, timezone)
  return job.nextRuns(n, from)
}

export function previousRunCroner(
  expr: string,
  from: Date,
  timezone?: string | null,
): Date | null {
  const job = parseCroner(expr, timezone)
  const prev = job.previousRuns(1, from)
  return prev[0] ?? null
}

export function tryParseCroner(
  expr: string,
  timezone?: string | null,
): { ok: true } | { ok: false; message: string } {
  try {
    parseCroner(expr, timezone)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid cron expression"
    return { ok: false, message }
  }
}
