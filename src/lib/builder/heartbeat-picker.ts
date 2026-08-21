import { hydrateSchedule } from "@/lib/schedule/hydrate"
import { serializeSchedule } from "@/lib/schedule/persist"
import type { ScheduleValue } from "@/lib/schedule/types"

export type PickerHeartbeatSchedule = {
  frequency: string
  time: string
}

/**
 * Map DB orchestrator heartbeat fields → Builder picker value.
 * Null/missing frequency + HEARTBEAT.md cron (or deployed cron exprs) hydrates
 * as the selected editor value (times / monthly / cron) - never silent "Off"
 * for an armed claw, never a template-schedule banner.
 */
export function resolvePickerHeartbeatSchedule(args: {
  heartbeatFrequency: string | null | undefined
  heartbeatTime?: string | null | undefined
  heartbeatMd?: string | null | undefined
  heartbeatCronExpressions?: string | null | undefined
  timezone?: string | null | undefined
}): PickerHeartbeatSchedule {
  const value = hydrateSchedule({
    heartbeatFrequency: args.heartbeatFrequency,
    heartbeatTime: args.heartbeatTime,
    heartbeatMd: args.heartbeatMd,
    heartbeatCronExpressions: args.heartbeatCronExpressions,
    timezone: args.timezone,
  })
  return scheduleToPickerState(value)
}

export function scheduleToPickerState(value: ScheduleValue): PickerHeartbeatSchedule {
  const ser = serializeSchedule(value)
  return {
    frequency: ser.heartbeatFrequency ?? "off",
    time: ser.heartbeatTime ?? "08:00",
  }
}
