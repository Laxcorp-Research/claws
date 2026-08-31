import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  planSpendLimit,
  shouldShowSpendLimitBanner,
  spendLimitReached,
} from "@/lib/healing/spend-limit"

describe("spend-limit enforcement", () => {
  it("reaches at 100% of a positive limit", () => {
    expect(spendLimitReached({ currentMonthApiCost: 50, apiSpendLimit: 50 })).toBe(true)
    expect(spendLimitReached({ currentMonthApiCost: 49.99, apiSpendLimit: 50 })).toBe(false)
    expect(spendLimitReached({ currentMonthApiCost: 10, apiSpendLimit: 0 })).toBe(false)
  })

  it("plans enforce / resolve / noop", () => {
    expect(planSpendLimit({ reached: true, alreadyEnforced: false })).toEqual({ action: "enforce" })
    expect(planSpendLimit({ reached: true, alreadyEnforced: true })).toEqual({ action: "noop" })
    expect(planSpendLimit({ reached: false, alreadyEnforced: true })).toEqual({ action: "resolve" })
    expect(planSpendLimit({ reached: false, alreadyEnforced: false })).toEqual({ action: "noop" })
  })

  it("MUTATION: banner-without-enforcement restored fails", () => {
    expect(
      shouldShowSpendLimitBanner({
        spendReached: true,
        workspaceStatus: "RUNNING",
        enforced: false,
      }),
    ).toBe(false)
    expect(
      shouldShowSpendLimitBanner({
        spendReached: true,
        workspaceStatus: "PAUSED",
        enforced: true,
      }),
    ).toBe(true)
    const page = readFileSync(
      join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
      "utf8",
    )
    expect(page).toMatch(/spendLimitReached && workspace\?\.status === "PAUSED"/)
    const impl = readFileSync(join(process.cwd(), "src/lib/healing/spend-limit.ts"), "utf8")
    expect(impl).toContain("syncThenRemoveDeployment")
    expect(impl).not.toMatch(/syncThenDestroy\(/)
  })
})
