import type { ScheduleValue, TimeSlot, Weekday } from "@/lib/schedule/types"
import { cronExprToIdSlug } from "@/lib/openclaw/heartbeat-md-cron"

export type PlannedCron = {
  expr: string
  tz: string | undefined
  idSuffix: string
}

function parseHhMm(time: string | null | undefined): { hour: number; minute: number } | null {
  if (!time) return null
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function formatDow(weekdays: Weekday[]): string {
  if (weekdays.length === 0 || weekdays.length === 7) return "*"
  const uniq = [...new Set(weekdays)].sort((a, b) => a - b)
  const isWeekdays = uniq.length === 5 && uniq.every((d, i) => d === ([1, 2, 3, 4, 5][i] as Weekday))
  if (isWeekdays) return "1-5"
  return uniq.join(",")
}

function slotExpr(slot: TimeSlot): string {
  return `${slot.minute} ${slot.hour} * * ${formatDow(slot.weekdays)}`
}

function tzOrUndef(tz: string | null | undefined): string | undefined {
  const t = tz?.trim()
  return t && t.length > 0 ? t : undefined
}

function extraPlanned(
  expressions: string[] | undefined,
  tz: string | undefined,
): PlannedCron[] {
  if (!expressions?.length) return []
  return expressions.map((expr) => ({
    expr: expr.trim(),
    tz,
    idSuffix: `cron-${cronExprToIdSlug(expr)}`,
  }))
}

/**
 * Canonical schedule → 5-field cron expressions (croner-shaped).
 * One emission vocabulary for preview and generator.
 */
export function scheduleToCronExprs(
  value: ScheduleValue,
  workspaceTimezone: string | null | undefined,
): PlannedCron[] {
  const wsTz = tzOrUndef(workspaceTimezone)

  switch (value.mode) {
    case "off":
      return []
    case "hourly":
      return [{ expr: "0 * * * *", tz: wsTz, idSuffix: "hourly" }]
    case "every_6h":
      return [{ expr: "0 */6 * * *", tz: wsTz, idSuffix: "every_6h" }]
    case "every_12h":
      return [{ expr: "0 */12 * * *", tz: wsTz, idSuffix: "every_12h" }]
    // daily/weekday: authored tz (stamped by the editor) wins; legacy rows
    // without a stamp keep the workspace tz, so pre-existing schedules never
    // shift on this change.
    case "daily": {
      const t = parseHhMm(value.time) ?? { hour: 8, minute: 0 }
      return [{ expr: `${t.minute} ${t.hour} * * *`, tz: tzOrUndef(value.tz) ?? wsTz, idSuffix: "daily" }]
    }
    case "weekday": {
      const t = parseHhMm(value.time) ?? { hour: 8, minute: 0 }
      return [{ expr: `${t.minute} ${t.hour} * * 1-5`, tz: tzOrUndef(value.tz) ?? wsTz, idSuffix: "weekday" }]
    }
    case "times": {
      const tz = tzOrUndef(value.tz) ?? wsTz
      const fromSlots = value.slots.map((slot) => ({
        expr: slotExpr(slot),
        tz,
        idSuffix: `times-${slot.hour}-${slot.minute}-${formatDow(slot.weekdays)}`,
      }))
      return [...fromSlots, ...extraPlanned(value.extraExpressions, tz)]
    }
    case "interval": {
      const n = value.everyMinutes
      const base =
        n >= 60 && n % 60 === 0
          ? [{ expr: `0 */${n / 60} * * *`, tz: wsTz, idSuffix: `interval-${n}m` }]
          : [{ expr: `*/${n} * * * *`, tz: wsTz, idSuffix: `interval-${n}m` }]
      return [...base, ...extraPlanned(value.extraExpressions, wsTz)]
    }
    case "monthly": {
      const tz = tzOrUndef(value.tz) ?? wsTz
      const dom = value.day === "last" ? "L" : String(value.day)
      return [
        {
          expr: `${value.minute} ${value.hour} ${dom} * *`,
          tz,
          idSuffix: `monthly-${dom}`,
        },
        ...extraPlanned(value.extraExpressions, tz),
      ]
    }
    case "cron": {
      const tz = tzOrUndef(value.tz) ?? wsTz
      return value.expressions.map((expr) => ({
        expr: expr.trim(),
        tz,
        idSuffix: `cron-${cronExprToIdSlug(expr)}`,
      }))
    }
    case "test_5min":
      return [{ expr: "*/5 * * * *", tz: undefined, idSuffix: "test_5min" }]
  }
}

export const HEARTBEAT_CRON_NAME_PREFIX = "orchestrator-heartbeat-"

export type EmittedHeartbeatJob = {
  id: string
  name: string
  description: string
  enabled: boolean
  deleteAfterRun: boolean
  schedule: { kind: "cron"; expr: string; tz?: string }
  agentId: string
  sessionTarget: string
  wakeMode: "now"
  payload: { kind: "agentTurn"; message: string }
}

export function emitHeartbeatJobs(args: {
  value: ScheduleValue
  timezone: string | null | undefined
  orchestratorAgentSlug: string
}): EmittedHeartbeatJob[] {
  const planned = scheduleToCronExprs(args.value, args.timezone)
  const slug = args.orchestratorAgentSlug
  return planned.map((p) => ({
    id: `heartbeat-${slug}-${p.idSuffix}`,
    name: `${HEARTBEAT_CRON_NAME_PREFIX}${p.idSuffix}`,
    description: `Orchestrator heartbeat (${p.expr}${p.tz ? ` ${p.tz}` : ""})`,
    enabled: true,
    deleteAfterRun: false,
    schedule: {
      kind: "cron" as const,
      expr: p.expr,
      ...(p.tz ? { tz: p.tz } : {}),
    },
    agentId: slug,
    sessionTarget: `session:agent:${slug}:main`,
    wakeMode: "now" as const,
    payload: {
      kind: "agentTurn" as const,
      message:
        "Heartbeat. Read HEARTBEAT.md and follow it strictly. " +
        "If nothing needs attention, reply HEARTBEAT_OK.",
    },
  }))
}
