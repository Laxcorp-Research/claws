import { extractCronExprsFromHeartbeatMd } from "@/lib/openclaw/heartbeat-md-cron"
import { expandCronExprToSlots, isMonthlyCron } from "@/lib/schedule/expand"
import { deserializeSchedule } from "@/lib/schedule/persist"
import type { ScheduleValue, TimeSlot } from "@/lib/schedule/types"

function exprsFromDeployedJobs(heartbeatCronExpressions: string | null | undefined): string[] {
  if (!heartbeatCronExpressions || heartbeatCronExpressions === "[]") return []
  try {
    const jobs = JSON.parse(heartbeatCronExpressions) as unknown
    if (!Array.isArray(jobs)) return []
    const exprs: string[] = []
    for (const job of jobs) {
      if (!job || typeof job !== "object") continue
      const sched = (job as { schedule?: { kind?: unknown; expr?: unknown } }).schedule
      if (sched && sched.kind === "cron" && typeof sched.expr === "string" && sched.expr.length > 0) {
        exprs.push(sched.expr)
      }
    }
    return exprs
  } catch {
    return []
  }
}

function hydrateFromExprs(exprs: string[], tz: string): ScheduleValue {
  const unique = [...new Set(exprs.map((e) => e.trim()).filter((e) => e.length > 0))]
  if (unique.length === 0) return { mode: "off" }

  const slots: TimeSlot[] = []
  const rest: string[] = []
  for (const expr of unique) {
    const expanded = expandCronExprToSlots(expr)
    if (expanded && slots.length + expanded.length <= 24) {
      slots.push(...expanded)
    } else {
      rest.push(expr)
    }
  }

  if (slots.length > 0 && rest.length === 0) {
    return { mode: "times", slots, tz }
  }
  if (slots.length > 0 && rest.length > 0) {
    return { mode: "times", slots, tz, extraExpressions: rest }
  }
  if (rest.length === 1) {
    const monthly = isMonthlyCron(rest[0])
    if (monthly) {
      return { mode: "monthly", ...monthly, tz }
    }
  }
  return { mode: "cron", expressions: unique, tz }
}

/**
 * DB + HEARTBEAT.md + deployed jobs → canonical editor value.
 * Persisted frequency wins. Null frequency hydrates MD/deployed cron as the
 * selected value (times rows when expandable) - never a banner, never silent Off
 * for an armed claw.
 */
export function hydrateSchedule(args: {
  heartbeatFrequency?: string | null
  heartbeatTime?: string | null
  heartbeatMd?: string | null
  heartbeatCronExpressions?: string | null
  timezone?: string | null
}): ScheduleValue {
  const tz =
    args.timezone && args.timezone.trim().length > 0 ? args.timezone.trim() : "UTC"

  if (args.heartbeatFrequency === "off") return { mode: "off" }

  const persisted = deserializeSchedule(args.heartbeatFrequency, args.heartbeatTime)
  if (persisted) return persisted

  const fromMd = extractCronExprsFromHeartbeatMd(args.heartbeatMd ?? "")
  const fromDeployed = exprsFromDeployedJobs(args.heartbeatCronExpressions)
  const exprs = fromMd.length > 0 ? fromMd : fromDeployed
  return hydrateFromExprs(exprs, tz)
}
