import type { ScheduleValue, Weekday } from "@/lib/schedule/types"
import { isValidIanaTimeZone } from "@/lib/schedule/wall-time"

const TIME_RE = /^\d{1,2}:\d{2}$/

/** Range-checked HH:MM (TIME_RE alone matches "99:99"). New-format use only. */
function isValidWallTime(time: string): boolean {
  if (!TIME_RE.test(time)) return false
  const [h, m] = time.split(":").map((n) => parseInt(n, 10))
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function extraFrom(raw: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(raw.extraExpressions)) return undefined
  const extra = raw.extraExpressions.filter(
    (e): e is string => typeof e === "string" && e.trim().length > 0,
  )
  return extra.length > 0 ? extra : undefined
}

export function serializeSchedule(value: ScheduleValue): {
  heartbeatFrequency: string | null
  heartbeatTime: string | null
} {
  switch (value.mode) {
    case "off":
      return { heartbeatFrequency: "off", heartbeatTime: null }
    case "hourly":
    case "every_6h":
    case "every_12h":
    case "test_5min":
      return { heartbeatFrequency: value.mode, heartbeatTime: null }
    case "daily":
    case "weekday":
      // Dual-format: rows the editor stamped with an authored tz persist as
      // JSON {time, tz}; unstamped values keep the legacy plain "HH:MM"
      // string BYTE-IDENTICAL, so hydrating and re-saving an untouched
      // legacy row never rewrites its format (or its workspace-tz emission).
      return {
        heartbeatFrequency: value.mode,
        heartbeatTime:
          value.tz && isValidIanaTimeZone(value.tz)
            ? JSON.stringify({ time: value.time, tz: value.tz })
            : value.time,
      }
    case "times":
    case "interval":
    case "monthly":
    case "cron":
      return {
        heartbeatFrequency: value.mode,
        heartbeatTime: JSON.stringify(payloadFor(value)),
      }
  }
}

function payloadFor(
  value: Extract<ScheduleValue, { mode: "times" | "interval" | "monthly" | "cron" }>,
): unknown {
  switch (value.mode) {
    case "times":
      return {
        slots: value.slots,
        tz: value.tz,
        ...(value.authoredTz && isValidIanaTimeZone(value.authoredTz)
          ? { authoredTz: value.authoredTz }
          : {}),
        ...(value.extraExpressions?.length
          ? { extraExpressions: value.extraExpressions }
          : {}),
      }
    case "interval":
      return {
        everyMinutes: value.everyMinutes,
        ...(value.extraExpressions?.length
          ? { extraExpressions: value.extraExpressions }
          : {}),
      }
    case "monthly":
      return {
        day: value.day,
        hour: value.hour,
        minute: value.minute,
        tz: value.tz,
        ...(value.extraExpressions?.length
          ? { extraExpressions: value.extraExpressions }
          : {}),
      }
    case "cron":
      return { expressions: value.expressions, tz: value.tz }
  }
}

export function deserializeSchedule(
  frequency: string | null | undefined,
  time: string | null | undefined,
): ScheduleValue | null {
  if (!frequency || frequency === "") return null
  if (frequency === "custom") return null
  if (frequency === "off") return { mode: "off" }
  if (frequency === "hourly") return { mode: "hourly" }
  if (frequency === "every_6h") return { mode: "every_6h" }
  if (frequency === "every_12h") return { mode: "every_12h" }
  if (frequency === "test_5min") return { mode: "test_5min" }
  if (frequency === "daily" || frequency === "weekday") {
    const mode = frequency
    // Stamped format: JSON {time, tz}. Invalid tz is dropped (not propagated)
    // so the row degrades to legacy workspace-tz semantics instead of feeding
    // junk zones into croner/Intl.
    if (time && time.trim().startsWith("{")) {
      try {
        const raw: unknown = JSON.parse(time)
        if (isRecord(raw)) {
          const t = typeof raw.time === "string" && isValidWallTime(raw.time) ? raw.time : "08:00"
          const tz =
            typeof raw.tz === "string" && isValidIanaTimeZone(raw.tz) ? raw.tz : undefined
          return { mode, time: t, ...(tz ? { tz } : {}) }
        }
      } catch {
        // fall through to the legacy default below
      }
      return { mode, time: "08:00" }
    }
    return { mode, time: time && TIME_RE.test(time) ? time : "08:00" }
  }
  if (!time || !time.trim().startsWith("{")) return null
  let raw: unknown
  try {
    raw = JSON.parse(time)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  if (frequency === "times") {
    if (!Array.isArray(raw.slots)) return null
    const tz = typeof raw.tz === "string" && raw.tz.length > 0 ? raw.tz : "UTC"
    // Invalid pins are dropped rather than propagated: display code feeds
    // authoredTz straight into Intl, which throws on junk zones.
    const authoredTz =
      typeof raw.authoredTz === "string" && isValidIanaTimeZone(raw.authoredTz)
        ? raw.authoredTz
        : undefined
    const slots = raw.slots.flatMap((s) => {
      if (!isRecord(s)) return []
      const hour = s.hour
      const minute = s.minute
      if (typeof hour !== "number" || typeof minute !== "number") return []
      const weekdays: Weekday[] = Array.isArray(s.weekdays)
        ? s.weekdays.filter(
            (d): d is Weekday =>
              typeof d === "number" && d >= 0 && d <= 6 && Number.isInteger(d),
          )
        : [0, 1, 2, 3, 4, 5, 6]
      return [{ hour, minute, weekdays }]
    })
    return {
      mode: "times",
      slots,
      tz,
      ...(authoredTz ? { authoredTz } : {}),
      extraExpressions: extraFrom(raw),
    }
  }
  if (frequency === "interval") {
    const n = raw.everyMinutes
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null
    return { mode: "interval", everyMinutes: n, extraExpressions: extraFrom(raw) }
  }
  if (frequency === "monthly") {
    const hour = raw.hour
    const minute = raw.minute
    if (typeof hour !== "number" || typeof minute !== "number") return null
    const day = raw.day === "last" ? "last" : typeof raw.day === "number" ? raw.day : null
    if (day === null) return null
    const tz = typeof raw.tz === "string" && raw.tz.length > 0 ? raw.tz : "UTC"
    return { mode: "monthly", day, hour, minute, tz, extraExpressions: extraFrom(raw) }
  }
  if (frequency === "cron") {
    if (!Array.isArray(raw.expressions)) return null
    const expressions = raw.expressions.filter(
      (e): e is string => typeof e === "string" && e.trim().length > 0,
    )
    const tz = typeof raw.tz === "string" && raw.tz.length > 0 ? raw.tz : "UTC"
    return { mode: "cron", expressions, tz }
  }
  return null
}
