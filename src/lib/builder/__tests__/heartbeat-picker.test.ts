import { describe, expect, it } from "vitest"
import { resolvePickerHeartbeatSchedule } from "@/lib/builder/heartbeat-picker"
import { serializeSchedule } from "@/lib/schedule/persist"

const MD_TWO = `- cron: "0 8 * * *"
  task: morning
- cron: "0 21 * * *"
  task: evening`

describe("resolvePickerHeartbeatSchedule", () => {
  it("null frequency + HEARTBEAT.md cron windows → times (not Off, not banner custom)", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: MD_TWO,
      timezone: "UTC",
    })
    expect(r.frequency).toBe("times")
    expect(r.frequency).not.toBe("off")
    expect(r.frequency).not.toBe("custom")
    const parsed = JSON.parse(r.time) as { slots: Array<{ hour: number; minute: number }> }
    expect(parsed.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hour: 8, minute: 0 }),
        expect.objectContaining({ hour: 21, minute: 0 }),
      ]),
    )
  })

  it("null frequency + deployed heartbeatCronExpressions → times", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: null,
      heartbeatCronExpressions: JSON.stringify([
        { schedule: { kind: "cron", expr: "0 8 * * *" } },
        { schedule: { kind: "cron", expr: "0 12 * * *" } },
        { schedule: { kind: "cron", expr: "0 18 * * *" } },
      ]),
      timezone: "UTC",
    })
    expect(r.frequency).toBe("times")
    const parsed = JSON.parse(r.time) as { slots: unknown[] }
    expect(parsed.slots).toHaveLength(3)
  })

  it("explicit off stays Off even when MD has cron", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: "off",
      heartbeatMd: MD_TWO,
    })
    expect(r.frequency).toBe("off")
  })

  it("daily frequency wins over MD cron", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: "daily",
      heartbeatTime: "09:00",
      heartbeatMd: MD_TWO,
    })
    expect(r).toEqual({ frequency: "daily", time: "09:00" })
  })

  it("null frequency + no cron → Off", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: "# HEARTBEAT.md\n\n- [ ] Check status\n",
    })
    expect(r.frequency).toBe("off")
  })

  it("MUTATION: default-render-for-armed restored → fails (null freq + cron ≠ Off)", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: MD_TWO,
    })
    expect(r.frequency).not.toBe("off")
    expect(r.frequency).toBe("times")
  })

  it("round-trips a times value through serialize", () => {
    const ser = serializeSchedule({
      mode: "times",
      tz: "Asia/Dubai",
      slots: [{ hour: 14, minute: 43, weekdays: [1, 2, 3, 4, 5] }],
    })
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: ser.heartbeatFrequency,
      heartbeatTime: ser.heartbeatTime,
    })
    expect(r.frequency).toBe("times")
    expect(JSON.parse(r.time).slots[0]).toMatchObject({ hour: 14, minute: 43 })
  })
})
