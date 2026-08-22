import { describe, expect, it } from "vitest"
import { convertSlotWall, convertWallTime } from "@/lib/schedule/wall-time"
import type { TimeSlot } from "@/lib/schedule/types"

const ALL_DAYS: TimeSlot["weekdays"] = [0, 1, 2, 3, 4, 5, 6]

describe("convertWallTime - browser-local wall clock ⇄ UTC (D6 incident math)", () => {
  it("19:00 typed in Asia/Dubai (+04) is 15:00 UTC, same calendar day", () => {
    const c = convertWallTime({ hour: 19, minute: 0, fromTz: "Asia/Dubai", toTz: "UTC" })
    expect(c).toEqual({ hour: 15, minute: 0, dayShift: 0 })
  })

  it("15:00 UTC renders as 19:00 in Asia/Dubai (render direction)", () => {
    const c = convertWallTime({ hour: 15, minute: 0, fromTz: "UTC", toTz: "Asia/Dubai" })
    expect(c).toEqual({ hour: 19, minute: 0, dayShift: 0 })
  })

  it("02:00 Dubai crosses midnight westward: 22:00 UTC on the PREVIOUS day", () => {
    const c = convertWallTime({ hour: 2, minute: 0, fromTz: "Asia/Dubai", toTz: "UTC" })
    expect(c).toEqual({ hour: 22, minute: 0, dayShift: -1 })
  })

  it("22:00 UTC crosses midnight eastward: 02:00 Dubai on the NEXT day", () => {
    const c = convertWallTime({ hour: 22, minute: 0, fromTz: "UTC", toTz: "Asia/Dubai" })
    expect(c).toEqual({ hour: 2, minute: 0, dayShift: 1 })
  })

  it("is DST-aware, not a manual offset: 19:00 London is 19:00Z in January but 18:00Z in July", () => {
    const winter = convertWallTime({
      hour: 19, minute: 0, fromTz: "Europe/London", toTz: "UTC",
      ref: new Date("2026-01-15T12:00:00Z"),
    })
    const summer = convertWallTime({
      hour: 19, minute: 0, fromTz: "Europe/London", toTz: "UTC",
      ref: new Date("2026-07-15T12:00:00Z"),
    })
    expect(winter.hour).toBe(19)
    expect(summer.hour).toBe(18)
  })

  it("handles sub-hour offsets: 19:00 Asia/Kathmandu (+05:45) is 13:15 UTC", () => {
    const c = convertWallTime({ hour: 19, minute: 0, fromTz: "Asia/Kathmandu", toTz: "UTC" })
    expect(c).toEqual({ hour: 13, minute: 15, dayShift: 0 })
  })

  it("same-zone conversion is the identity", () => {
    const c = convertWallTime({ hour: 7, minute: 30, fromTz: "UTC", toTz: "UTC" })
    expect(c).toEqual({ hour: 7, minute: 30, dayShift: 0 })
  })
})

describe("convertSlotWall - weekday sets rotate with the midnight crossing", () => {
  it("Mon-Fri 02:00 Dubai stores as Sun-Thu 22:00 UTC, and round-trips back", () => {
    const local: TimeSlot = { hour: 2, minute: 0, weekdays: [1, 2, 3, 4, 5] }
    const stored = convertSlotWall(local, "Asia/Dubai", "UTC")
    expect(stored).toEqual({ hour: 22, minute: 0, weekdays: [0, 1, 2, 3, 4] })
    expect(convertSlotWall(stored, "UTC", "Asia/Dubai")).toEqual(local)
  })

  it("weekday rotation wraps the week: Sat 02:00 Dubai → Fri 22:00 UTC; Sun 22:00 UTC → Mon 02:00 Dubai", () => {
    expect(convertSlotWall({ hour: 2, minute: 0, weekdays: [6] }, "Asia/Dubai", "UTC").weekdays).toEqual([5])
    expect(convertSlotWall({ hour: 22, minute: 0, weekdays: [0] }, "UTC", "Asia/Dubai").weekdays).toEqual([1])
  })

  it("all-days sets survive rotation unchanged (no dupes, sorted)", () => {
    const slot: TimeSlot = { hour: 2, minute: 0, weekdays: [...ALL_DAYS] }
    expect(convertSlotWall(slot, "Asia/Dubai", "UTC").weekdays).toEqual(ALL_DAYS)
  })

  it("no-crossing conversions keep the weekday set as-is (19:00 Dubai case)", () => {
    const slot: TimeSlot = { hour: 19, minute: 0, weekdays: [1, 3, 5] }
    expect(convertSlotWall(slot, "Asia/Dubai", "UTC")).toEqual({
      hour: 15, minute: 0, weekdays: [1, 3, 5],
    })
  })

  it("same-zone slots pass through untouched", () => {
    const slot: TimeSlot = { hour: 8, minute: 0, weekdays: [1, 2] }
    expect(convertSlotWall(slot, "UTC", "UTC")).toBe(slot)
  })
})
