// @vitest-environment jsdom
//
// PR-7 (Bug A defense-in-depth): formatDollars must never emit "$NaN".

import { describe, it, expect } from "vitest"
import { formatDollars } from "@/components/credits/usage-summary"

describe("formatDollars", () => {
  it("formats cents to dollars", () => {
    expect(formatDollars(140)).toBe("$1.40")
    expect(formatDollars(0)).toBe("$0.00")
    expect(formatDollars(2500)).toBe("$25.00")
  })

  it("guards nullish / non-finite inputs → $0.00 (never $NaN)", () => {
    expect(formatDollars(undefined)).toBe("$0.00")
    expect(formatDollars(null)).toBe("$0.00")
    expect(formatDollars(NaN)).toBe("$0.00")
    expect(formatDollars(Infinity)).toBe("$0.00")
  })
})
