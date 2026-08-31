import { describe, expect, it } from "vitest"
import { computeNextOccurrences } from "@/lib/schedule/occurrences"
import { deserializeSchedule, serializeSchedule } from "@/lib/schedule/persist"
import type { ScheduleValue } from "@/lib/schedule/types"

const FROM = new Date("2026-08-17T12:00:00.000Z") // Monday

describe("tz matrix - GST / UTC / US-west render, UTC instants", () => {
  const value: ScheduleValue = { mode: "daily", time: "08:00" }

  it("unstamped daily 08:00 is UTC regardless of workspace tz", () => {
    const utc = computeNextOccurrences({ value, timezone: "UTC", from: FROM, n: 1 })[0]
    const gst = computeNextOccurrences({ value, timezone: "Asia/Dubai", from: FROM, n: 1 })[0]
    const west = computeNextOccurrences({
      value,
      timezone: "America/Los_Angeles",
      from: FROM,
      n: 1,
    })[0]
    expect(utc.utcIso).toBe("2026-08-18T08:00:00.000Z")
    expect(gst.utcIso).toBe("2026-08-18T08:00:00.000Z")
    expect(west.utcIso).toBe("2026-08-18T08:00:00.000Z")
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
    expect(row.utcIso).toBe("2026-08-18T08:00:00.000Z")
    expect(row.localIso).toMatch(/12:00:00/)
  })
})

describe("authoredTz persistence - the pin survives the DB round trip", () => {
  const slots = [{ hour: 15, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] as Array<0 | 1 | 2 | 3 | 4 | 5 | 6> }]

  it("times serializes authoredTz and deserializes it back", () => {
    const ser = serializeSchedule({ mode: "times", tz: "UTC", authoredTz: "Asia/Dubai", slots })
    expect(JSON.parse(ser.heartbeatTime ?? "{}").authoredTz).toBe("Asia/Dubai")

    const value = deserializeSchedule("times", ser.heartbeatTime)
    expect(value?.mode).toBe("times")
    if (value?.mode === "times") expect(value.authoredTz).toBe("Asia/Dubai")
  })

  it("invalid authoredTz in stored JSON is dropped, not propagated", () => {
    const raw = JSON.stringify({ slots, tz: "UTC", authoredTz: "Not/AZone" })
    const value = deserializeSchedule("times", raw)
    if (value?.mode === "times") expect(value.authoredTz).toBeUndefined()
  })

  it("legacy payloads without authoredTz deserialize with the field absent", () => {
    const raw = JSON.stringify({ slots, tz: "UTC" })
    const value = deserializeSchedule("times", raw)
    if (value?.mode === "times") expect(value.authoredTz).toBeUndefined()
  })
})

// #454 follow-up: daily/weekday presets used to be workspace-tz only. New
// saves stamp the authored tz; legacy rows keep workspace-tz emission. These
// tests fail if either side of that contract is broken.
describe("daily/weekday authored-tz stamp", () => {
  it("stamped daily fires in the authored tz, not the workspace tz", () => {
    const row = computeNextOccurrences({
      value: { mode: "daily", time: "08:00", tz: "Asia/Dubai" },
      timezone: "America/Los_Angeles", // workspace tz must NOT win
      from: FROM,
      n: 1,
    })[0]
    // 08:00 GST = 04:00 UTC
    expect(row.utcIso).toBe("2026-08-18T04:00:00.000Z")
  })

  it("B-3: unstamped daily fires UTC even when workspace tz is Dubai", () => {
    const row = computeNextOccurrences({
      value: { mode: "daily", time: "08:00" },
      timezone: "Asia/Dubai",
      from: FROM,
      n: 1,
    })[0]
    expect(row.utcIso).toBe("2026-08-18T08:00:00.000Z")
  })

  it("stamped weekday fires in the authored tz", () => {
    const row = computeNextOccurrences({
      value: { mode: "weekday", time: "09:30", tz: "Asia/Dubai" },
      timezone: "UTC",
      from: FROM, // Monday
      n: 1,
    })[0]
    expect(row.utcIso).toBe("2026-08-18T05:30:00.000Z")
  })

  it("stamped daily persists as JSON {time, tz} and round-trips", () => {
    const ser = serializeSchedule({ mode: "daily", time: "19:00", tz: "Asia/Dubai" })
    expect(ser.heartbeatFrequency).toBe("daily")
    expect(JSON.parse(ser.heartbeatTime ?? "{}")).toEqual({ time: "19:00", tz: "Asia/Dubai" })

    const value = deserializeSchedule("daily", ser.heartbeatTime)
    expect(value).toEqual({ mode: "daily", time: "19:00", tz: "Asia/Dubai" })
  })

  it("FORMAT LOCK: unstamped daily serializes to the plain legacy string byte-identical", () => {
    // Hydrate -> re-save of an untouched legacy row must not rewrite its
    // format (that WOULD change nothing today but would break rollback and
    // dirty every row it passes through).
    const value = deserializeSchedule("daily", "19:00")
    expect(value).toEqual({ mode: "daily", time: "19:00" })
    const ser = serializeSchedule(value as ScheduleValue)
    expect(ser.heartbeatTime).toBe("19:00")
  })

  it("invalid tz in a stamped payload is dropped -> legacy workspace-tz semantics", () => {
    const value = deserializeSchedule("weekday", JSON.stringify({ time: "07:15", tz: "Not/AZone" }))
    expect(value).toEqual({ mode: "weekday", time: "07:15" })
  })

  it("malformed stamped payload degrades to the 08:00 default, never throws", () => {
    expect(deserializeSchedule("daily", "{nope")).toEqual({ mode: "daily", time: "08:00" })
    expect(deserializeSchedule("daily", JSON.stringify({ time: "99:99", tz: "UTC" }))).toEqual({
      mode: "daily",
      time: "08:00",
      tz: "UTC",
    })
  })
})
