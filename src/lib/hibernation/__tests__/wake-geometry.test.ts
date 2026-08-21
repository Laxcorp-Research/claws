import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  computeWakeLeadMs,
  DEFAULT_WAKE_MIN_LEAD_MS,
  isPastDueHint,
  isWakeEligible,
} from "@/lib/hibernation/wake-geometry"

const ENV_KEYS = [
  "HIBERNATION_CRON_CADENCE_MS",
  "HIBERNATION_WAKE_BUFFER_MS",
  "HIBERNATION_WAKE_MIN_LEAD_MS",
] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe("computeWakeLeadMs", () => {
  it("floors at ≥30m even when avgWake is tiny (fixture 44s shape)", () => {
    const lead = computeWakeLeadMs(44_448)
    expect(lead).toBeGreaterThanOrEqual(DEFAULT_WAKE_MIN_LEAD_MS)
    expect(lead).toBeGreaterThanOrEqual(30 * 60 * 1000)
  })

  it("≥30m floor holds with env absent (covers observed 22–30m GH gaps)", () => {
    for (const k of ENV_KEYS) delete process.env[k]
    const lead = computeWakeLeadMs(44_448)
    expect(lead).toBe(DEFAULT_WAKE_MIN_LEAD_MS)
    expect(lead).toBe(30 * 60 * 1000)
    // MUTATION: restore 8m default → Aug-11 class (tick at T−11m ineligible).
    expect(lead).toBeGreaterThan(8 * 60 * 1000)
  })

  it("grows with cadence + avg + buffer above the floor", () => {
    process.env.HIBERNATION_CRON_CADENCE_MS = String(5 * 60 * 1000)
    process.env.HIBERNATION_WAKE_BUFFER_MS = String(60 * 1000)
    process.env.HIBERNATION_WAKE_MIN_LEAD_MS = String(30 * 60 * 1000)
    // 5m + 40m avg + 1m = 46m > 30m floor
    expect(computeWakeLeadMs(40 * 60 * 1000)).toBe(46 * 60 * 1000)
  })

  it("MUTATION: restoring 8m floor fails gap-coverage (Aug-11 07:49→08:14 class)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-geometry.ts"),
      "utf8",
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/DEFAULT_WAKE_MIN_LEAD_MS\s*=\s*8\s*\*\s*60/)
    expect(code).toContain("DEFAULT_WAKE_MIN_LEAD_MS")
    expect(code).toContain("30 * 60 * 1000")

    const lead = computeWakeLeadMs(44_448)
    // Observed gap before 08:00 miss: last tick 07:49 (11m before beat).
    // With 30m lead, deadline=07:30 → 07:49 is eligible.
    const next = new Date("2026-08-11T08:00:00.000Z")
    const tickBeforeWindow = new Date("2026-08-11T07:49:00.000Z")
    expect(
      isWakeEligible({
        now: tickBeforeWindow,
        nextHeartbeatAt: next,
        avgWakeDurationMs: 44_448,
      }),
    ).toBe(true)
    expect(lead).toBe(30 * 60 * 1000)
  })

  it("MUTATION: restoring 2m clamp would fail the cadence floor", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-geometry.ts"),
      "utf8",
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/Math\.max\(\s*120_000/)
    expect(code).not.toMatch(/Math\.max\(\s*120\s*\*\s*1000/)
    expect(code).toContain("HIBERNATION_CRON_CADENCE_MS")

    const lead = computeWakeLeadMs(44_448)
    const buggyTwoMinClamp = Math.min(600_000, Math.max(120_000, 44_448 * 2))
    expect(buggyTwoMinClamp).toBe(120_000)
    expect(lead).toBeGreaterThan(buggyTwoMinClamp)
  })
})

describe("isWakeEligible - no upper cutoff", () => {
  it("past-due hint is eligible (late wake beats never)", () => {
    const next = new Date("2026-07-20T12:00:00.000Z")
    const now = new Date("2026-07-20T12:10:00.000Z")
    expect(
      isWakeEligible({ now, nextHeartbeatAt: next, avgWakeDurationMs: 44_448 }),
    ).toBe(true)
    expect(isPastDueHint(now, next)).toBe(true)
  })

  it("inside lead window before hint is eligible", () => {
    const next = new Date("2026-07-20T16:00:00.000Z")
    // 30m lead → deadline 15:30; 15:40 is inside
    const now = new Date("2026-07-20T15:40:00.000Z")
    expect(
      isWakeEligible({ now, nextHeartbeatAt: next, avgWakeDurationMs: 44_448 }),
    ).toBe(true)
  })

  it("before wakeDeadline is not eligible", () => {
    const next = new Date("2026-07-20T16:00:00.000Z")
    const now = new Date("2026-07-20T15:20:00.000Z") // 40m early; lead≥30m → deadline 15:30
    expect(
      isWakeEligible({ now, nextHeartbeatAt: next, avgWakeDurationMs: 44_448 }),
    ).toBe(false)
  })

  it("MUTATION: restoring gt:now upper cutoff would exclude past-due", () => {
    const cronSrc = readFileSync(
      join(process.cwd(), "src/app/api/cron/hibernation/route.ts"),
      "utf8",
    )
    expect(cronSrc).not.toMatch(/nextHeartbeatAt:\s*\{\s*lte:\s*maxLookAhead/)
    expect(cronSrc).not.toMatch(/gt:\s*now/)
    expect(cronSrc).toContain("isWakeEligible")
    expect(cronSrc).toContain("wakeHibernatedWhere")
    expect(cronSrc).toContain("wakeEligibility")
  })

  it("MUTATION: sever wake selection (drop isWakeEligible gate) → fail", () => {
    const cronSrc = readFileSync(
      join(process.cwd(), "src/app/api/cron/hibernation/route.ts"),
      "utf8",
    )
    expect(cronSrc).toMatch(/if\s*\(\s*!isWakeEligible/)
    expect(cronSrc).toContain("scheduleWake")
    expect(cronSrc).toContain("wakeHibernatedWhere")
  })
})
