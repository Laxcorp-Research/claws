import { extractCronExprsFromHeartbeatMd } from "@/lib/openclaw/heartbeat-md-cron"

/** Frequencies the Builder picker can persist / display as first-class. */
const PICKER_FREQUENCIES = new Set([
  "off",
  "hourly",
  "every_6h",
  "every_12h",
  "daily",
  "weekday",
  "test_5min",
])

export type PickerHeartbeatSchedule = {
  frequency: string
  time: string
  /** Present when frequency is the synthetic `custom` (MD / deployed cron windows). */
  customWindowCount: number | null
}

export function countCronWindowsFromMd(heartbeatMd: string | null | undefined): number {
  return extractCronExprsFromHeartbeatMd(heartbeatMd ?? "").length
}

export function countCronWindowsFromExpressions(
  heartbeatCronExpressions: string | null | undefined,
): number {
  if (!heartbeatCronExpressions || heartbeatCronExpressions === "[]") return 0
  try {
    const jobs = JSON.parse(heartbeatCronExpressions) as unknown
    if (!Array.isArray(jobs)) return 0
    return jobs.length
  } catch {
    return 0
  }
}

/**
 * Map DB orchestrator heartbeat fields → Builder picker value.
 * Null/missing frequency + HEARTBEAT.md cron (or deployed cron exprs) → `custom`,
 * never silently "Off" for an armed claw.
 */
export function resolvePickerHeartbeatSchedule(args: {
  heartbeatFrequency: string | null | undefined
  heartbeatTime?: string | null | undefined
  heartbeatMd?: string | null | undefined
  heartbeatCronExpressions?: string | null | undefined
}): PickerHeartbeatSchedule {
  const time =
    typeof args.heartbeatTime === "string" && args.heartbeatTime.length > 0
      ? args.heartbeatTime
      : "08:00"

  const freq =
    typeof args.heartbeatFrequency === "string" && args.heartbeatFrequency.length > 0
      ? args.heartbeatFrequency
      : null

  if (freq && PICKER_FREQUENCIES.has(freq)) {
    return { frequency: freq, time, customWindowCount: null }
  }
  if (freq && freq !== "custom") {
    return { frequency: freq, time, customWindowCount: null }
  }

  const fromMd = countCronWindowsFromMd(args.heartbeatMd)
  const fromExprs = countCronWindowsFromExpressions(args.heartbeatCronExpressions)
  const n = Math.max(fromMd, fromExprs)
  if (n > 0) {
    return { frequency: "custom", time, customWindowCount: n }
  }
  return { frequency: "off", time, customWindowCount: null }
}

export function customHeartbeatLabel(count: number | null | undefined): string {
  if (typeof count === "number" && count > 0) {
    return `Custom (${count} window${count === 1 ? "" : "s"})`
  }
  return "Custom schedule"
}
