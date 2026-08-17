import type { TimeSlot, Weekday } from "@/lib/schedule/types"

function expandField(field: string, min: number, max: number): number[] | null {
  const trimmed = field.trim()
  if (trimmed === "*") {
    const all: number[] = []
    for (let i = min; i <= max; i++) all.push(i)
    return all
  }
  const out = new Set<number>()
  for (const piece of trimmed.split(",")) {
    const stepMatch = piece.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10)
      if (!Number.isInteger(step) || step <= 0) return null
      let start = min
      let end = max
      if (stepMatch[1] !== "*") {
        const range = stepMatch[1].split("-").map((n) => parseInt(n, 10))
        start = range[0]
        end = range[1] ?? range[0]
      }
      if (start < min || end > max || start > end) return null
      for (let i = start; i <= end; i += step) out.add(i)
      continue
    }
    const rangeMatch = piece.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10)
      const b = parseInt(rangeMatch[2], 10)
      if (a < min || b > max || a > b) return null
      for (let i = a; i <= b; i++) out.add(i)
      continue
    }
    if (/^\d+$/.test(piece)) {
      const n = parseInt(piece, 10)
      if (n < min || n > max) return null
      out.add(n)
      continue
    }
    return null
  }
  return [...out].sort((a, b) => a - b)
}

function expandDow(field: string): Weekday[] | null {
  const mapped = field.replace(/7/g, "0")
  const nums = expandField(mapped, 0, 6)
  if (!nums) return null
  return nums as Weekday[]
}

/**
 * Expand a 5-field cron into Custom-times slots when the DOM/month are wildcards.
 * Returns null when the expr is monthly, uses L, or isn't a finite slot list.
 */
export function expandCronExprToSlots(expr: string): TimeSlot[] | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minuteF, hourF, domF, monthF, dowF] = parts
  if (domF !== "*" || monthF !== "*") return null
  if (/[L#W]/i.test(expr)) return null
  const minutes = expandField(minuteF, 0, 59)
  const hours = expandField(hourF, 0, 23)
  const weekdays = expandDow(dowF)
  if (!minutes || !hours || !weekdays) return null
  if (minutes.length * hours.length > 24) return null
  const slots: TimeSlot[] = []
  for (const hour of hours) {
    for (const minute of minutes) {
      slots.push({ hour, minute, weekdays: [...weekdays] })
    }
  }
  return slots
}

export function tryExpandExprsToTimes(
  exprs: string[],
  tz: string,
): { mode: "times"; slots: TimeSlot[]; tz: string } | null {
  if (exprs.length === 0) return null
  const merged: TimeSlot[] = []
  for (const expr of exprs) {
    const slots = expandCronExprToSlots(expr)
    if (!slots) return null
    merged.push(...slots)
  }
  if (merged.length === 0 || merged.length > 24) return null
  return { mode: "times", slots: merged, tz }
}

export function isMonthlyCron(expr: string): {
  day: number | "last"
  hour: number
  minute: number
} | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minuteF, hourF, domF, monthF, dowF] = parts
  if (monthF !== "*" || dowF !== "*") return null
  if (!/^\d+$/.test(minuteF) || !/^\d+$/.test(hourF)) return null
  const minute = parseInt(minuteF, 10)
  const hour = parseInt(hourF, 10)
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null
  if (domF === "L") return { day: "last", hour, minute }
  if (/^\d+$/.test(domF)) {
    const day = parseInt(domF, 10)
    if (day >= 1 && day <= 31) return { day, hour, minute }
  }
  return null
}
