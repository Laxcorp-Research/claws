import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Cron } from "croner"
import { describe, expect, it } from "vitest"
import { CRONER_FIVE_FIELD, nextRunsCroner } from "@/lib/schedule/croner-parse"
import { computeNextOccurrences } from "@/lib/schedule/occurrences"

const FROM = new Date("2026-08-17T12:00:00.000Z")
const TZ = "UTC"

// 20 expressions: last-day (L), star-slash-15, ranges, lists, DOW.
const EXPRESSIONS = [
  "0 8 * * *",
  "30 14 * * 1-5",
  "*/15 * * * *",
  "0 */6 * * *",
  "0 9 1 * *",
  "0 9 L * *",
  "0 12,16,20 * * *",
  "0 8-18 * * 1-5",
  "15 9 * * 0",
  "0 0 1,15 * *",
  "45 7 * * 1,3,5",
  "0 9-17/2 * * 1-5",
  "*/30 8-16 * * 1-5",
  "0 8 * * 1-5",
  "59 23 * * *",
  "0 0 * * 0",
  "10 10 10 * *",
  "0 6 * * 6",
  "5 4 * * 1",
  "0 21 * * *",
] as const

describe("croner parity — preview vs runtime parser", () => {
  it("covers 20 expressions including L, */15, and ranges", () => {
    expect(EXPRESSIONS).toHaveLength(20)
    expect(EXPRESSIONS.some((e) => e.includes("L"))).toBe(true)
    expect(EXPRESSIONS.some((e) => e.includes("*/15"))).toBe(true)
    expect(EXPRESSIONS.some((e) => e.includes("-"))).toBe(true)
  })

  it("computeNextOccurrences matches Cron.nextRuns from the croner package", () => {
    for (const expr of EXPRESSIONS) {
      const runtime = new Cron(expr, { ...CRONER_FIVE_FIELD, timezone: TZ })
      const runtimeRuns = runtime.nextRuns(5, FROM)
      const shared = nextRunsCroner(expr, 5, FROM, TZ)
      const preview = computeNextOccurrences({
        value: { mode: "cron", expressions: [expr], tz: TZ },
        timezone: TZ,
        from: FROM,
        n: 5,
      })
      expect(shared.map((d) => d.toISOString()), expr).toEqual(
        runtimeRuns.map((d) => d.toISOString()),
      )
      expect(preview.map((r) => r.at.toISOString()), expr).toEqual(
        runtimeRuns.map((d) => d.toISOString()),
      )
    }
  })

  it("MUTATION: lookalike-parser substituted in croner-parse → fail", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/schedule/croner-parse.ts"), "utf8")
    expect(src).toMatch(/from ["']croner["']/)
    expect(src).not.toMatch(/from ["']cron-parser["']/)
    expect(src).not.toMatch(/CronExpressionParser/)
    expect(src).not.toMatch(/from ["']cron["']/)
  })
})
