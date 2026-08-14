import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildDailyFromRecords,
  startOfUtcDay,
  usageWindowStart,
  utcDateKey,
  USAGE_DAILY_WINDOW_DAYS,
  type UsageLedgerRecord,
} from "@/lib/credits/usage-ledger"

function rec(overrides: Partial<UsageLedgerRecord> & { createdAt: Date }): UsageLedgerRecord {
  return {
    workspaceId: "ws-1",
    provider: "ANTHROPIC",
    model: "anthropic/claude-haiku-4-5-20251001",
    inputTokens: 100,
    outputTokens: 50,
    costCents: 2,
    ...overrides,
  }
}

describe("usage ledger window", () => {
  it("last 30 UTC days include today", () => {
    const now = new Date("2026-08-14T16:30:00.000Z")
    expect(USAGE_DAILY_WINDOW_DAYS).toBe(30)
    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-14T00:00:00.000Z")
    expect(usageWindowStart(now).toISOString()).toBe("2026-07-16T00:00:00.000Z")
  })

  it("rows-present today ⇒ aggregates non-empty (cron yesterday bound would drop them)", () => {
    const now = new Date("2026-08-14T16:30:00.000Z")
    const records = [
      rec({ createdAt: new Date("2026-08-14T13:05:00.000Z"), costCents: 3 }),
      rec({ createdAt: new Date("2026-08-14T14:10:00.000Z"), costCents: 1 }),
      rec({ createdAt: new Date("2026-08-14T15:20:00.000Z"), costCents: 4 }),
      rec({ createdAt: new Date("2026-08-14T16:00:00.000Z"), costCents: 2 }),
      rec({ createdAt: new Date("2026-08-14T16:15:00.000Z"), costCents: 2 }),
      rec({ createdAt: new Date("2026-08-14T16:25:00.000Z"), costCents: 2 }),
    ]
    const daily = buildDailyFromRecords(records, "acct-1", now)
    expect(daily.length).toBeGreaterThan(0)
    expect(daily[0]?.date.startsWith("2026-08-14")).toBe(true)
    expect(daily[0]?.totalCalls).toBe(6)
    expect(daily[0]?.totalCostCents).toBe(14)
    expect(daily.map((d) => `${d.provider}::${d.model}`)).toContain(
      "ANTHROPIC::anthropic/claude-haiku-4-5-20251001",
    )

    // The cron window: createdAt < UTC yesterday midnight — today's 6 rows vanish.
    const cronCutoff = startOfUtcDay(new Date(now.getTime() - 86400000))
    const cronVisible = records.filter((r) => {
      const t = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
      return t < cronCutoff
    })
    expect(cronVisible).toHaveLength(0)
    expect(buildDailyFromRecords(cronVisible, "acct-1", now)).toHaveLength(0)
  })

  it("MUTATION: window bug restored (drop today / use CreditUsageDaily only) → fail", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/credits/usage/route.ts"), "utf8")
    expect(src).toContain("buildDailyFromRecords")
    expect(src).toContain("usageWindowStart")
    expect(src).not.toContain("creditUsageDaily.findMany")
    const ledger = readFileSync(join(process.cwd(), "src/lib/credits/usage-ledger.ts"), "utf8")
    expect(ledger).toContain("created < from")
    expect(ledger).not.toMatch(/startOfUtcDay\(\s*new Date\(Date\.now\(\) - 86400000\)/)
  })

  it("UTC date key is calendar-day not local", () => {
    expect(utcDateKey(new Date("2026-08-14T23:50:00.000Z"))).toBe("2026-08-14")
    expect(utcDateKey(new Date("2026-08-15T00:10:00.000Z"))).toBe("2026-08-15")
  })
})
