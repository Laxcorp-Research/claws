import { describe, expect, it } from "vitest"
import { computeNextOccurrences } from "@/lib/schedule/occurrences"
import { serializeSchedule } from "@/lib/schedule/persist"
import type { ScheduleValue } from "@/lib/schedule/types"

const FROM = new Date("2026-08-17T12:00:00.000Z") // Monday

describe("tz matrix — GST / UTC / US-west render, UTC instants", () => {
  const value: ScheduleValue = { mode: "daily", time: "08:00" }

  it("same wall-clock 08:00 yields distinct UTC instants per workspace tz", () => {
    const utc = computeNextOccurrences({ value, timezone: "UTC", from: FROM, n: 1 })[0]
    const gst = computeNextOccurrences({ value, timezone: "Asia/Dubai", from: FROM, n: 1 })[0]
    const west = computeNextOccurrences({
      value,
      timezone: "America/Los_Angeles",
      from: FROM,
      n: 1,
    })[0]
    expect(utc.utcIso).toBe("2026-08-18T08:00:00.000Z")
    // GST (UTC+4): 08:00 GST = 04:00 UTC
    expect(gst.utcIso).toBe("2026-08-18T04:00:00.000Z")
    // US-west PDT (UTC-7 in August): 08:00 PT = 15:00 UTC
    expect(west.utcIso).toBe("2026-08-17T15:00:00.000Z")
    expect(new Set([utc.utcIso, gst.utcIso, west.utcIso]).size).toBe(3)
  })

  it("times JSON stores wall-clock + IANA tz (not a pre-baked UTC string)", () => {
    const ser = serializeSchedule({
      mode: "times",
      tz: "Asia/Dubai",
      slots: [{ hour: 8, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] }],
    })
    expect(ser.heartbeatFrequency).toBe("times")
    const payload = JSON.parse(ser.heartbeatTime ?? "{}") as { tz: string; slots: Array<{ hour: number }> }
    expect(payload.tz).toBe("Asia/Dubai")
    expect(payload.slots[0].hour).toBe(8)
    expect(ser.heartbeatTime).not.toMatch(/2026-/)
  })

  it("preview localIso uses the display timezone while utcIso stays Z", () => {
    const row = computeNextOccurrences({
      value: { mode: "daily", time: "08:00" },
      timezone: "Asia/Dubai",
      from: FROM,
      n: 1,
      displayTimeZone: "Asia/Dubai",
    })[0]
    expect(row.utcIso.endsWith("Z")).toBe(true)
    expect(row.localIso).toMatch(/08:00:00/)
  })
})
