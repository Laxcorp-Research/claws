import { describe, expect, it } from "vitest"
import {
  customHeartbeatLabel,
  resolvePickerHeartbeatSchedule,
} from "@/lib/builder/heartbeat-picker"

const MD_TWO = `- cron: "0 8 * * *"
  task: morning
- cron: "0 21 * * *"
  task: evening`

describe("resolvePickerHeartbeatSchedule", () => {
  it("null frequency + HEARTBEAT.md cron windows → custom (not Off)", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: MD_TWO,
    })
    expect(r.frequency).toBe("custom")
    expect(r.customWindowCount).toBe(2)
    expect(customHeartbeatLabel(r.customWindowCount)).toBe(
      "Runs on its template schedule (2 windows/day)",
    )
  })

  it("null frequency + deployed heartbeatCronExpressions → custom", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: null,
      heartbeatCronExpressions: JSON.stringify([
        { schedule: { kind: "cron", expr: "0 8 * * *" } },
        { schedule: { kind: "cron", expr: "0 12 * * *" } },
        { schedule: { kind: "cron", expr: "0 18 * * *" } },
      ]),
    })
    expect(r.frequency).toBe("custom")
    expect(r.customWindowCount).toBe(3)
  })

  it("explicit off stays Off even when MD has cron", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: "off",
      heartbeatMd: MD_TWO,
    })
    expect(r.frequency).toBe("off")
    expect(r.customWindowCount).toBeNull()
  })

  it("daily frequency wins over MD cron", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: "daily",
      heartbeatTime: "09:00",
      heartbeatMd: MD_TWO,
    })
    expect(r).toEqual({ frequency: "daily", time: "09:00", customWindowCount: null })
  })

  it("null frequency + no cron → Off", () => {
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: "# HEARTBEAT.md\n\n- [ ] Check status\n",
    })
    expect(r.frequency).toBe("off")
  })

  it("customHeartbeatLabel falls back to template-schedule copy", () => {
    expect(customHeartbeatLabel(null)).toBe("Runs on its template schedule")
    expect(customHeartbeatLabel(1)).toBe("Runs on its template schedule (1 window/day)")
  })

  it("MUTATION: default-render-for-armed restored → fails (null freq + cron ≠ Off)", () => {
    // If resolvePickerHeartbeatSchedule regresses to treating null+cron as Off,
    // armed claws show "Off" in the picker while still beating.
    const r = resolvePickerHeartbeatSchedule({
      heartbeatFrequency: null,
      heartbeatMd: MD_TWO,
    })
    expect(r.frequency).not.toBe("off")
    expect(r.frequency).toBe("custom")
  })
})
