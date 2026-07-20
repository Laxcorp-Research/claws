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
  it("floors at ≥8m even when avgWake is tiny (fixture 44s shape)", () => {
    // Old clamp: max(120_000, 44448*2)=120_000 → wakeDeadline 2m early → 12:00 FAIL.
    const lead = computeWakeLeadMs(44_448)
    expect(lead).toBeGreaterThanOrEqual(DEFAULT_WAKE_MIN_LEAD_MS)
    expect(lead).toBeGreaterThanOrEqual(8 * 60 * 1000)
  })

  it("grows with cadence + avg + buffer above the floor", () => {
    process.env.HIBERNATION_CRON_CADENCE_MS = String(5 * 60 * 1000)
    process.env.HIBERNATION_WAKE_BUFFER_MS = String(60 * 1000)
    process.env.HIBERNATION_WAKE_MIN_LEAD_MS = String(8 * 60 * 1000)
    // 5m + 10m avg + 1m = 16m > 8m floor
    expect(computeWakeLeadMs(10 * 60 * 1000)).toBe(16 * 60 * 1000)
  })

  it("MUTATION: restoring 2m clamp would fail the cadence floor", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/wake-geometry.ts"),
      "utf8",
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/Math\.max\(\s*120_000/)
    expect(code).not.toMatch(/Math\.max\(\s*120\s*\*\s*1000/)
    expect(code).toContain("DEFAULT_WAKE_MIN_LEAD_MS")
    expect(code).toContain("HIBERNATION_CRON_CADENCE_MS")

    const lead = computeWakeLeadMs(44_448)
    const buggyTwoMinClamp = Math.min(600_000, Math.max(120_000, 44_448 * 2))
    expect(buggyTwoMinClamp).toBe(120_000)
    expect(lead).toBeGreaterThan(buggyTwoMinClamp)
  })
})

describe("isWakeEligible — no upper cutoff", () => {
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
    // 8m lead → deadline 15:52; 15:56 is inside
    const now = new Date("2026-07-20T15:56:00.000Z")
    expect(
      isWakeEligible({ now, nextHeartbeatAt: next, avgWakeDurationMs: 44_448 }),
    ).toBe(true)
  })

  it("before wakeDeadline is not eligible", () => {
    const next = new Date("2026-07-20T16:00:00.000Z")
    const now = new Date("2026-07-20T15:50:00.000Z") // 10m early; lead≥8m → deadline 15:52
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
    expect(cronSrc).toContain("nextHeartbeatAt: { not: null }")
  })
})
