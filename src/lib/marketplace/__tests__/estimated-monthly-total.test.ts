import { describe, expect, it } from "vitest"
import { formatEstimatedMonthlyTotal } from "@/lib/marketplace/estimated-monthly-total"

describe("formatEstimatedMonthlyTotal (Batch A / A5 - no-$NaN)", () => {
  it("adds platform fee to a plain numeric estimate", () => {
    expect(formatEstimatedMonthlyTotal("40")).toBe("119")
    expect(formatEstimatedMonthlyTotal("40.5")).toBe("119.5")
  })

  it("falls back for null/empty", () => {
    expect(formatEstimatedMonthlyTotal(null)).toBe("120–160")
    expect(formatEstimatedMonthlyTotal(undefined)).toBe("120–160")
    expect(formatEstimatedMonthlyTotal("")).toBe("120–160")
  })

  it("falls back for non-numeric ranges (mutation: Number()+79 → $NaN)", () => {
    expect(formatEstimatedMonthlyTotal("40–80")).toBe("120–160")
    expect(formatEstimatedMonthlyTotal("~$50")).toBe("120–160")
    expect(formatEstimatedMonthlyTotal("free")).toBe("120–160")
    // Guard: never produce NaN
    expect(formatEstimatedMonthlyTotal("40–80")).not.toContain("NaN")
    expect(String(Number("40–80") + 79)).toBe("NaN") // documents the bug class
  })
})
