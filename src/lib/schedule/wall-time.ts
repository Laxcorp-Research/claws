/**
 * Wall-clock ⇄ timezone conversion for schedule slots, built on Intl (the real
 * ICU timezone database - never manual offsets, so the offset is correct for
 * the reference date, including DST and sub-hour zones).
 *
 * Used by the custom-times editor: users type wall-clock times in their
 * BROWSER timezone; storage is normalized to UTC (D6 incident: a Dubai founder
 * typed 19:00 into a workspace whose tz defaulted to UTC and got a 19:00Z
 * schedule, 23:00 his time).
 *
 * A slot has no date, so conversion needs an anchor: the wall time is resolved
 * on the reference date (default: now) in the source zone. For fixed-offset
 * zones (Dubai, UTC) this is exact year-round; for DST zones the stored UTC
 * value anchors to the offset in effect at save time.
 */
import type { TimeSlot, Weekday } from "@/lib/schedule/types"

type WallParts = { year: number; month: number; day: number; hour: number; minute: number }

function partsInZone(at: Date, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // h23 (not hour12:false) so midnight is "00", never ICU's legacy "24".
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
  const bag: Record<string, string> = {}
  for (const p of dtf.formatToParts(at)) bag[p.type] = p.value
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
  }
}

/** Epoch ms of the instant whose wall clock in `timeZone` reads `parts`. */
function zonedWallToEpoch(parts: WallParts, timeZone: string): number {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  // Two-pass offset probe (same technique as date-fns-tz): the zone offset at
  // the guessed instant can differ from the offset at the true instant near a
  // DST transition; one refinement converges for every real-world zone.
  let epoch = wanted
  for (let i = 0; i < 2; i++) {
    const seen = partsInZone(new Date(epoch), timeZone)
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute)
    epoch += wanted - seenUtc
  }
  return epoch
}

export type WallConversion = { hour: number; minute: number; dayShift: -1 | 0 | 1 }

/**
 * Convert a wall-clock time from one zone to another, anchored on `ref`'s
 * calendar date in `fromTz`. `dayShift` reports whether the target wall clock
 * lands on the previous/same/next calendar day (used to rotate weekday sets).
 */
export function convertWallTime(args: {
  hour: number
  minute: number
  fromTz: string
  toTz: string
  ref?: Date
}): WallConversion {
  const { hour, minute, fromTz, toTz } = args
  if (fromTz === toTz) return { hour, minute, dayShift: 0 }
  const ref = args.ref ?? new Date()
  const anchor = partsInZone(ref, fromTz)
  const epoch = zonedWallToEpoch({ ...anchor, hour, minute }, fromTz)
  const target = partsInZone(new Date(epoch), toTz)
  const srcDay = Date.UTC(anchor.year, anchor.month - 1, anchor.day)
  const dstDay = Date.UTC(target.year, target.month - 1, target.day)
  const dayShift = Math.round((dstDay - srcDay) / 86_400_000) as -1 | 0 | 1
  return { hour: target.hour, minute: target.minute, dayShift }
}

/**
 * Convert a slot's wall time between zones, rotating the weekday set when the
 * conversion crosses midnight (e.g. Mon-Fri 02:00 Dubai = Sun-Thu 22:00 UTC).
 */
export function convertSlotWall(
  slot: TimeSlot,
  fromTz: string,
  toTz: string,
  ref?: Date,
): TimeSlot {
  if (fromTz === toTz) return slot
  const conv = convertWallTime({ hour: slot.hour, minute: slot.minute, fromTz, toTz, ref })
  const weekdays = [
    ...new Set(slot.weekdays.map((d) => ((((d + conv.dayShift) % 7) + 7) % 7) as Weekday)),
  ].sort((a, b) => a - b)
  return { hour: conv.hour, minute: conv.minute, weekdays }
}
