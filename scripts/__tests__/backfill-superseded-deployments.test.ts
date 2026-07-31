import { describe, expect, it } from "vitest"
import { BACKFILL_SQL, PROD_FOUNDER_CARD, runBackfill } from "../backfill-superseded-deployments"

describe("backfill-superseded-deployments", () => {
  it("SQL keeps newest COMPLETED per workspace, supersedes rn>1", () => {
    expect(BACKFILL_SQL).toContain('PARTITION BY "workspaceId"')
    expect(BACKFILL_SQL).toContain('ORDER BY "startedAt" DESC')
    expect(BACKFILL_SQL).toContain("r.rn > 1")
    expect(BACKFILL_SQL).toContain("SUPERSEDED")
    expect(BACKFILL_SQL).toContain("status = 'COMPLETED'")
  })

  it("dry-run does not execute SQL", async () => {
    let called = false
    const result = await runBackfill({
      confirm: false,
      executeSql: async () => {
        called = true
        return { rowCount: 0 }
      },
    })
    expect(result.mode).toBe("dry-run")
    expect(called).toBe(false)
  })

  it("confirm applies SQL", async () => {
    const result = await runBackfill({
      confirm: true,
      executeSql: async () => ({ rowCount: 72 }),
    })
    expect(result.mode).toBe("applied")
    expect(result.rowCount).toBe(72)
  })

  it("prod founder card is non-empty and read-only framed", () => {
    expect(PROD_FOUNDER_CARD).toContain("DO NOT auto-run")
    expect(PROD_FOUNDER_CARD).toContain(BACKFILL_SQL)
  })
})
