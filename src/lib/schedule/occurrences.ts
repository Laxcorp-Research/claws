import { nextRunsCroner, tryParseCroner } from "@/lib/schedule/croner-parse"
import { scheduleToCronExprs } from "@/lib/schedule/emit"
import type { NextOccurrence, ScheduleValue } from "@/lib/schedule/types"

function formatLocal(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

/**
 * Next N fires for a canonical schedule. Preview and runtime share croner
 * via scheduleToCronExprs → nextRunsCroner.
 */
export function computeNextOccurrences(args: {
  value: ScheduleValue
  timezone: string
  from?: Date
  n?: number
  displayTimeZone?: string
}): NextOccurrence[] {
  const n = args.n ?? 5
  const from = args.from ?? new Date()
  const displayTz = args.displayTimeZone ?? args.timezone
  const planned = scheduleToCronExprs(args.value, args.timezone)
  const dated: NextOccurrence[] = []
  for (const { expr, tz } of planned) {
    const parsed = tryParseCroner(expr, tz)
    if (!parsed.ok) continue
    const runs = nextRunsCroner(expr, n, from, tz)
    for (const at of runs) {
      dated.push({
        at,
        expr,
        utcIso: at.toISOString(),
        localIso: formatLocal(at, displayTz),
      })
    }
  }
  dated.sort((a, b) => a.at.getTime() - b.at.getTime())
  const uniq: NextOccurrence[] = []
  for (const row of dated) {
    const last = uniq[uniq.length - 1]
    if (last && last.at.getTime() === row.at.getTime()) continue
    uniq.push(row)
    if (uniq.length >= n) break
  }
  return uniq
}

export function countFiresInNext24h(value: ScheduleValue, timezone: string, from: Date = new Date()): number {
  const until = from.getTime() + 24 * 60 * 60 * 1000
  const planned = scheduleToCronExprs(value, timezone)
  let count = 0
  for (const { expr, tz } of planned) {
    const parsed = tryParseCroner(expr, tz)
    if (!parsed.ok) continue
    const runs = nextRunsCroner(expr, 200, from, tz)
    for (const at of runs) {
      if (at.getTime() <= until) count += 1
      else break
    }
  }
  return count
}
