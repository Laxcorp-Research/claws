import { tryParseCroner } from "@/lib/schedule/croner-parse"
import { scheduleToCronExprs } from "@/lib/schedule/emit"
import { countFiresInNext24h } from "@/lib/schedule/occurrences"
import {
  FIRES_PER_DAY_CREDIT_WARN,
  FIRES_PER_DAY_HARD_CAP,
  INTERVAL_FLOOR_MINUTES,
  TIMES_CAP_PER_DAY,
  type ScheduleValue,
} from "@/lib/schedule/types"

export type ScheduleValidation = {
  ok: boolean
  errors: string[]
  firesPerDay: number
  creditWarning: string | null
}

function extrasOf(value: ScheduleValue): string[] {
  if (value.mode === "times" || value.mode === "interval" || value.mode === "monthly") {
    return value.extraExpressions ?? []
  }
  if (value.mode === "cron") return value.expressions
  return []
}

function extraFires(expressions: string[] | undefined, timezone: string): number {
  if (!expressions?.length) return 0
  return countFiresInNext24h(
    { mode: "cron", expressions, tz: timezone },
    timezone,
  )
}

function maxTimesFiresPerDay(value: Extract<ScheduleValue, { mode: "times" }>): number {
  const byDay = [0, 0, 0, 0, 0, 0, 0]
  for (const slot of value.slots) {
    for (const d of slot.weekdays) byDay[d] += 1
  }
  return Math.max(...byDay)
}

function estimateFiresPerDay(value: ScheduleValue, timezone: string): number {
  switch (value.mode) {
    case "off":
      return 0
    case "hourly":
      return 24
    case "every_6h":
      return 4
    case "every_12h":
      return 2
    case "daily":
      return 1
    case "weekday":
      return 1
    case "test_5min":
      return 288
    case "interval": {
      const n = value.everyMinutes
      const base = n > 0 ? Math.floor((24 * 60) / n) : 0
      return base + extraFires(value.extraExpressions, timezone)
    }
    case "times":
      return maxTimesFiresPerDay(value) + extraFires(value.extraExpressions, timezone)
    case "monthly":
      return 1 + extraFires(value.extraExpressions, timezone)
    case "cron":
      return countFiresInNext24h(value, timezone)
  }
}

export function validateSchedule(
  value: ScheduleValue,
  timezone: string,
): ScheduleValidation {
  const errors: string[] = []

  if (value.mode === "times") {
    if (value.slots.length > TIMES_CAP_PER_DAY) {
      errors.push(`Custom times are capped at ${TIMES_CAP_PER_DAY} slots per day`)
    }
    if (value.slots.length === 0 && (value.extraExpressions?.length ?? 0) === 0) {
      errors.push("Add at least one time or a cron expression")
    }
    for (const slot of value.slots) {
      if (slot.hour < 0 || slot.hour > 23 || slot.minute < 0 || slot.minute > 59) {
        errors.push("Each custom time must be a valid HH:MM")
      }
      if (slot.weekdays.length === 0) {
        errors.push("Each custom time needs at least one weekday")
      }
    }
  }

  if (value.mode === "interval") {
    if (value.everyMinutes < INTERVAL_FLOOR_MINUTES) {
      errors.push(
        `Interval must be at least ${INTERVAL_FLOOR_MINUTES} minutes (credit-burn floor)`,
      )
    }
    if (value.everyMinutes > 59 && value.everyMinutes % 60 !== 0) {
      errors.push("Hour-scale intervals must be a whole number of hours")
    }
  }

  if (value.mode === "monthly") {
    if (value.day !== "last" && (value.day < 1 || value.day > 31)) {
      errors.push("Monthly day must be 1–31 or last day")
    }
  }

  if (value.mode === "cron" && value.expressions.length === 0) {
    errors.push("Add at least one cron expression")
  }

  const tz = value.mode === "times" || value.mode === "monthly" || value.mode === "cron"
    ? value.tz
    : timezone
  for (const expr of extrasOf(value)) {
    const parsed = tryParseCroner(expr, tz)
    if (!parsed.ok) {
      errors.push(`Invalid cron "${expr}": ${parsed.message}`)
    }
  }

  const planned = scheduleToCronExprs(value, timezone)
  for (const p of planned) {
    const parsed = tryParseCroner(p.expr, p.tz ?? timezone)
    if (!parsed.ok) {
      errors.push(`Invalid cron "${p.expr}": ${parsed.message}`)
    }
  }

  const firesPerDay = estimateFiresPerDay(value, timezone)
  const intervalExempt = value.mode === "interval"
  if (!intervalExempt && firesPerDay > FIRES_PER_DAY_HARD_CAP) {
    errors.push(`Schedules are capped at ${FIRES_PER_DAY_HARD_CAP} fires per day`)
  }

  const creditWarning =
    firesPerDay >= FIRES_PER_DAY_CREDIT_WARN
      ? `~${firesPerDay} runs/day — this will consume credits quickly`
      : null

  return {
    ok: errors.length === 0,
    errors,
    firesPerDay,
    creditWarning,
  }
}
