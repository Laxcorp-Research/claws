import { describe, expect, it } from "vitest"
import { emitHeartbeatJobs, scheduleToCronExprs } from "@/lib/schedule/emit"
import { serializeSchedule } from "@/lib/schedule/persist"
import { buildHeartbeatSchedule } from "@/lib/openclaw/generator"
import type { ScheduleValue } from "@/lib/schedule/types"

const TZ = "UTC"
const SLUG = "proof-commander"

function exprs(value: ScheduleValue): string[] {
  return scheduleToCronExprs(value, TZ).map((p) => p.expr)
}

describe("per-mode emission snapshots", () => {
  it("off emits nothing", () => {
    expect(exprs({ mode: "off" })).toEqual([])
    expect(emitHeartbeatJobs({ value: { mode: "off" }, timezone: TZ, orchestratorAgentSlug: SLUG })).toEqual([])
  })

  it("hourly → 0 * * * *", () => {
    expect(exprs({ mode: "hourly" })).toEqual(["0 * * * *"])
  })

  it("every_6h / every_12h", () => {
    expect(exprs({ mode: "every_6h" })).toEqual(["0 */6 * * *"])
    expect(exprs({ mode: "every_12h" })).toEqual(["0 */12 * * *"])
  })

  it("daily / weekday", () => {
    expect(exprs({ mode: "daily", time: "08:00" })).toEqual(["0 8 * * *"])
    expect(exprs({ mode: "weekday", time: "09:30" })).toEqual(["30 9 * * 1-5"])
  })

  it("times × weekday mask + extra raw cron (proof-of-fire shape)", () => {
    const value: ScheduleValue = {
      mode: "times",
      tz: TZ,
      slots: [{ hour: 14, minute: 43, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
      extraExpressions: ["17 15 * * *"],
    }
    expect(exprs(value)).toEqual(["43 14 * * *", "17 15 * * *"])
    const jobs = emitHeartbeatJobs({ value, timezone: TZ, orchestratorAgentSlug: SLUG })
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => j.name.startsWith("orchestrator-heartbeat-"))).toBe(true)
    expect(jobs.every((j) => j.sessionTarget === `session:agent:${SLUG}:main`)).toBe(true)
  })

  it("interval floor 15m and hour-scale", () => {
    expect(exprs({ mode: "interval", everyMinutes: 15 })).toEqual(["*/15 * * * *"])
    expect(exprs({ mode: "interval", everyMinutes: 120 })).toEqual(["0 */2 * * *"])
  })

  it("monthly day-of-month and last day", () => {
    expect(exprs({ mode: "monthly", day: 1, hour: 9, minute: 0, tz: TZ })).toEqual(["0 9 1 * *"])
    expect(exprs({ mode: "monthly", day: "last", hour: 9, minute: 0, tz: TZ })).toEqual(["0 9 L * *"])
  })

  it("raw cron expressions pass through", () => {
    expect(exprs({ mode: "cron", expressions: ["*/15 * * * *", "0 9 L * *"], tz: TZ })).toEqual([
      "*/15 * * * *",
      "0 9 L * *",
    ])
  })

  it("test_5min omits tz", () => {
    const jobs = emitHeartbeatJobs({
      value: { mode: "test_5min" },
      timezone: "America/New_York",
      orchestratorAgentSlug: SLUG,
    })
    expect(jobs[0].schedule).toEqual({ kind: "cron", expr: "*/5 * * * *" })
  })

  it("generator buildHeartbeatSchedule shares emitHeartbeatJobs for times JSON", () => {
    const value: ScheduleValue = {
      mode: "times",
      tz: TZ,
      slots: [{ hour: 8, minute: 0, weekdays: [1, 2, 3, 4, 5] }],
    }
    const ser = serializeSchedule(value)
    const built = buildHeartbeatSchedule(ser.heartbeatFrequency, ser.heartbeatTime, TZ, SLUG)
    expect(built?.cronJobs?.map((j) => j.schedule.expr)).toEqual(["0 8 * * 1-5"])
  })
})
