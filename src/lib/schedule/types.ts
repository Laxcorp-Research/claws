/** Canonical heartbeat schedule. Times are wall-clock in `tz` (IANA). */

export const INTERVAL_FLOOR_MINUTES = 15
export const TIMES_CAP_PER_DAY = 24
export const FIRES_PER_DAY_HARD_CAP = 48
export const FIRES_PER_DAY_CREDIT_WARN = 24

export const PRESET_MODES = [
  "off",
  "hourly",
  "every_6h",
  "every_12h",
  "daily",
  "weekday",
] as const

export type PresetMode = (typeof PRESET_MODES)[number]

export type ScheduleMode =
  | PresetMode
  | "times"
  | "interval"
  | "monthly"
  | "cron"
  | "test_5min"

/** Sunday=0 … Saturday=6 (croner / JS). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type TimeSlot = {
  hour: number
  minute: number
  weekdays: Weekday[]
}

export type ScheduleValue =
  | { mode: "off" }
  | { mode: "hourly" }
  | { mode: "every_6h" }
  | { mode: "every_12h" }
  // daily/weekday: `tz` is the IANA zone the time was AUTHORED in (browser tz
  // at edit time). Absent = UTC (B-3: crons evaluate in the schedule's own tz;
  // workspace timezone is not a fire tz).
  | { mode: "daily"; time: string; tz?: string }
  | { mode: "weekday"; time: string; tz?: string }
  // times: slots are wall-clock in `tz` (UTC for editor-authored values).
  // `authoredTz` pins the timezone the user typed the times in - display-only
  // metadata (emit ignores it), so a traveling user's schedule never shifts.
  | { mode: "times"; slots: TimeSlot[]; tz: string; authoredTz?: string; extraExpressions?: string[] }
  | { mode: "interval"; everyMinutes: number; extraExpressions?: string[] }
  | { mode: "monthly"; day: number | "last"; hour: number; minute: number; tz: string; extraExpressions?: string[] }
  | { mode: "cron"; expressions: string[]; tz: string }
  | { mode: "test_5min" }

export type NextOccurrence = {
  at: Date
  expr: string
  utcIso: string
  localIso: string
}

export type CronParseError = {
  expr: string
  message: string
}
