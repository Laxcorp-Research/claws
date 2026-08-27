import { describe, expect, it } from "vitest"
import { validateSchedule } from "@/lib/schedule/guardrails"
import {
  FIRES_PER_DAY_HARD_CAP,
  INTERVAL_FLOOR_MINUTES,
} from "@/lib/schedule/types"

describe("schedule guardrails - caps and floors", () => {
  it("names the 15-minute interval floor honestly", () => {
    const v = validateSchedule({ mode: "interval", everyMinutes: 5 }, "UTC")
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes(String(INTERVAL_FLOOR_MINUTES)))).toBe(true)
    expect(v.errors.some((e) => /credit-burn floor/i.test(e))).toBe(true)
  })

  it("allows the 15-minute floor (96/day) with a credit warning", () => {
    const v = validateSchedule({ mode: "interval", everyMinutes: 15 }, "UTC")
    expect(v.ok).toBe(true)
    expect(v.firesPerDay).toBe(96)
    expect(v.creditWarning).toBe("~96 runs/day - this will consume credits quickly")
  })

  it("blocks custom times over 24 slots", () => {
    const slots = Array.from({ length: 25 }, (_, i) => ({
      hour: i % 24,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
    }))
    const v = validateSchedule({ mode: "times", slots, tz: "UTC" }, "UTC")
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => /24/.test(e))).toBe(true)
  })

  it(`blocks non-interval schedules over ${FIRES_PER_DAY_HARD_CAP} fires/day`, () => {
    const v = validateSchedule(
      { mode: "cron", expressions: ["*/10 * * * *"], tz: "UTC" },
      "UTC",
    )
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes(String(FIRES_PER_DAY_HARD_CAP)))).toBe(true)
  })

  it("invalid raw cron is an inline error and save is blocked", () => {
    const v = validateSchedule(
      { mode: "cron", expressions: ["not a cron"], tz: "UTC" },
      "UTC",
    )
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => /Invalid cron/i.test(e))).toBe(true)
  })

  it("invalid extra cron is reported once (not duplicated via extras + planned)", () => {
    const v = validateSchedule(
      {
        mode: "times",
        tz: "UTC",
        slots: [{ hour: 8, minute: 0, weekdays: [1, 2, 3, 4, 5] }],
        extraExpressions: ["nope"],
      },
      "UTC",
    )
    expect(v.ok).toBe(false)
    expect(v.errors.filter((e) => /Invalid cron/i.test(e))).toHaveLength(1)
  })

  it("daily at 24 fires/day shows the credit warning", () => {
    const slots = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6>,
    }))
    const v = validateSchedule({ mode: "times", slots, tz: "UTC" }, "UTC")
    expect(v.ok).toBe(true)
    expect(v.creditWarning).toMatch(/~24 runs\/day/)
  })
})
