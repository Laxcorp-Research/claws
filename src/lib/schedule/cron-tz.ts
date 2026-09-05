import { isValidIanaTimeZone } from "@/lib/schedule/wall-time"

/**
 * B-3 clock law: crons evaluate in the schedule's OWN tz.
 * UTC unless the user authored a pin. Workspace timezone is display/context
 * only. Labels never claim UTC unless the schedule tz is UTC.
 */
export const DEFAULT_CRON_TZ = "UTC"

export function resolveAuthoredCronTz(
  authoredTz: string | null | undefined,
): string {
  const t = authoredTz?.trim()
  if (t && isValidIanaTimeZone(t)) return t
  return DEFAULT_CRON_TZ
}

/** Platform + emit share this: missing/blank job tz is UTC, never process-local. */
export function cronTzOrUtc(tz: string | null | undefined): string {
  const t = tz?.trim()
  if (t && isValidIanaTimeZone(t)) return t
  return DEFAULT_CRON_TZ
}

export function hourMinuteFromCronExpr(expr: string): { hour: number; minute: number } | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = Number(parts[0])
  const hour = Number(parts[1])
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

/**
 * Honest wall-clock label. Never suffixes UTC unless the schedule tz is UTC.
 * MUTATION: appending "UTC" onto a non-UTC tz (the fire-claw 08:00 UTC lie) fails.
 */
export function formatCronWallLabel(expr: string, tz: string | null | undefined): string {
  const zone = cronTzOrUtc(tz)
  const hm = hourMinuteFromCronExpr(expr)
  if (!hm) return zone
  return `${pad2(hm.hour)}:${pad2(hm.minute)} ${zone}`
}

export function labelClaimsUtc(label: string): boolean {
  return /\bUTC\b/i.test(label)
}
