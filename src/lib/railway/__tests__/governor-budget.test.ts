import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CREATE_WINDOW_MS,
  RAILWAY_CREATE_QUOTA_CANONICAL,
  RAILWAY_CREATE_QUOTA_WRAPPED,
  budget80Threshold,
  computeQueueEta,
  formatQueueEta,
  isCreateBudgetAllowed,
  isRailwayCreateQuotaError,
  nextLedgerRollOff,
  parseCreateDailyCap,
  parseSafetyMargin,
  queuedUserMessage,
  quotaHoldUntilFromRejection,
  shouldAlertCreateBudget80,
  usableCreateBudget,
} from "@/lib/railway/governor-budget"

const NOW = new Date("2026-08-19T12:00:00.000Z")
const HOURS = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000)

describe("create budget config", () => {
  it("defaults cap 25 and margin 2 (usable 23)", () => {
    expect(parseCreateDailyCap(undefined)).toBe(25)
    expect(parseSafetyMargin(undefined)).toBe(2)
    expect(usableCreateBudget(25, 2)).toBe(23)
  })

  it("env-tunes cap when the Railway ticket raises it", () => {
    expect(parseCreateDailyCap("40")).toBe(40)
    expect(usableCreateBudget(40, 2)).toBe(38)
  })

  it("rejects non-positive cap / negative margin", () => {
    expect(parseCreateDailyCap("0")).toBe(25)
    expect(parseCreateDailyCap("-3")).toBe(25)
    expect(parseSafetyMargin("-1")).toBe(2)
    expect(parseSafetyMargin("0")).toBe(0)
  })
})

describe("rolling 24h window edges", () => {
  it("createdAt == windowStart is OUT (exclusive gt); +1ms is IN", () => {
    const windowStart = new Date(NOW.getTime() - CREATE_WINDOW_MS)
    const onEdge = [windowStart]
    const justInside = [new Date(windowStart.getTime() + 1)]
    expect(nextLedgerRollOff({ createdAtsOldestFirst: onEdge, usable: 1, now: NOW })).toBeNull()
    expect(
      nextLedgerRollOff({ createdAtsOldestFirst: justInside, usable: 1, now: NOW })?.toISOString(),
    ).toBe(new Date(justInside[0]!.getTime() + CREATE_WINDOW_MS).toISOString())
  })

  it("count == usable-1 is allowed; count == usable is not", () => {
    expect(
      isCreateBudgetAllowed({ rollingCount: 22, usable: 23, quotaHoldUntil: null, now: NOW }),
    ).toBe(true)
    expect(
      isCreateBudgetAllowed({ rollingCount: 23, usable: 23, quotaHoldUntil: null, now: NOW }),
    ).toBe(false)
  })

  it("active quota hold blocks even with empty ledger", () => {
    expect(
      isCreateBudgetAllowed({
        rollingCount: 0,
        usable: 23,
        quotaHoldUntil: new Date(NOW.getTime() + 60_000),
        now: NOW,
      }),
    ).toBe(false)
    expect(
      isCreateBudgetAllowed({
        rollingCount: 0,
        usable: 23,
        quotaHoldUntil: new Date(NOW.getTime() - 1),
        now: NOW,
      }),
    ).toBe(true)
  })

  it("roll-off ETA is the Nth oldest + 24h so count becomes usable-1", () => {
    // 23 in-window, usable 23 → mustExpire 1 → oldest + 24h
    const oldest = HOURS(20)
    const rest = Array.from({ length: 22 }, (_, i) => HOURS(19 - i * 0.1))
    const eta = nextLedgerRollOff({
      createdAtsOldestFirst: [oldest, ...rest],
      usable: 23,
      now: NOW,
    })
    expect(eta?.toISOString()).toBe(new Date(oldest.getTime() + CREATE_WINDOW_MS).toISOString())
  })

  it("two over usable → ETA is second-oldest + 24h", () => {
    const a = HOURS(23)
    const b = HOURS(22)
    const rest = Array.from({ length: 22 }, (_, i) => HOURS(10 - i * 0.01))
    const eta = nextLedgerRollOff({
      createdAtsOldestFirst: [a, b, ...rest],
      usable: 23,
      now: NOW,
    })
    expect(eta?.toISOString()).toBe(new Date(b.getTime() + CREATE_WINDOW_MS).toISOString())
  })

  it("computeQueueEta takes max(rollOff, hold)", () => {
    const oldest = HOURS(20)
    const rows = [oldest, ...Array.from({ length: 22 }, () => HOURS(19))]
    const hold = new Date(NOW.getTime() + 30 * 60 * 60 * 1000)
    const eta = computeQueueEta({
      createdAtsOldestFirst: rows,
      usable: 23,
      now: NOW,
      quotaHoldUntil: hold,
    })
    expect(eta.getTime()).toBe(hold.getTime())
  })
})

describe("quota hold from Railway rejection", () => {
  it("empty ledger → at least 15m (does not hammer */5)", () => {
    const hold = quotaHoldUntilFromRejection({
      createdAtsOldestFirst: [],
      usable: 23,
      now: NOW,
    })
    expect(hold.getTime()).toBe(NOW.getTime() + 15 * 60 * 1000)
  })

  it("full ledger → hold waits for roll-off when later than 15m", () => {
    const oldest = HOURS(1)
    const rows = [oldest, ...Array.from({ length: 22 }, () => HOURS(0.5))]
    const hold = quotaHoldUntilFromRejection({
      createdAtsOldestFirst: rows,
      usable: 23,
      now: NOW,
    })
    expect(hold.getTime()).toBe(oldest.getTime() + CREATE_WINDOW_MS)
  })
})

describe("Railway quota error matcher (req_0d3c2zp4er0t)", () => {
  it("matches the exact wrapped GraphQL string from the HWD canary", () => {
    expect(isRailwayCreateQuotaError(new Error(RAILWAY_CREATE_QUOTA_WRAPPED))).toBe(true)
    expect(isRailwayCreateQuotaError(RAILWAY_CREATE_QUOTA_CANONICAL)).toBe(true)
    expect(isRailwayCreateQuotaError(new Error("Railway GraphQL error: NotAuthorized"))).toBe(false)
    expect(isRailwayCreateQuotaError(new Error("rate limit"))).toBe(false)
  })

  it("MUTATION: needle stays 'service creation limit' (generic 'limit' would false-positive)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/railway/governor-budget.ts"), "utf8")
    expect(src).toContain("service creation limit")
    expect(src).toContain("req_0d3c2zp4er0t")
  })
})

describe("80% owner-alert threshold", () => {
  it("fires at 20 of 25 inclusive", () => {
    expect(budget80Threshold(25)).toBe(20)
    expect(shouldAlertCreateBudget80(19, 25)).toBe(false)
    expect(shouldAlertCreateBudget80(20, 25)).toBe(true)
    expect(shouldAlertCreateBudget80(25, 25)).toBe(true)
  })

  it("MUTATION: restoring exclusive > 80% misses the exact tick", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/railway/governor-budget.ts"), "utf8")
    expect(src).toMatch(/rollingCount >= budget80Threshold/)
  })
})

describe("honest queue copy", () => {
  it("locks the user-facing sentence", () => {
    const eta = new Date(NOW.getTime() + 3 * 60 * 60 * 1000)
    expect(formatQueueEta(eta, NOW)).toBe("3h")
    expect(queuedUserMessage(eta, NOW)).toBe(
      "High demand - your claw is queued to provision, ~3h. We'll notify you.",
    )
  })
})
