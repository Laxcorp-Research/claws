// Taste batch 2026-08-25: the skill-publish emoji guard was `length > 4`,
// which rejected ZWJ families (length 11) and accepted 4-char junk. These
// tests fail if anyone reverts to a UTF-16 length check.
import { describe, expect, it } from "vitest"
import { isSingleEmoji } from "../emoji"

describe("isSingleEmoji", () => {
  it("accepts a plain pictograph", () => {
    expect(isSingleEmoji("🔥")).toBe(true)
  })

  it("accepts a VS16 presentation form (❤️)", () => {
    expect(isSingleEmoji("❤️")).toBe(true)
  })

  it("accepts a skin-toned emoji (👍🏽)", () => {
    expect(isSingleEmoji("👍🏽")).toBe(true)
  })

  it("REGRESSION: accepts a ZWJ family (length 11 - the old length>4 guard rejected it)", () => {
    const family = "👨‍👩‍👧‍👦"
    expect(family.length).toBeGreaterThan(4) // documents why the old guard was wrong
    expect(isSingleEmoji(family)).toBe(true)
  })

  it("accepts a flag (🇦🇪) and a keycap (1️⃣)", () => {
    expect(isSingleEmoji("🇦🇪")).toBe(true)
    expect(isSingleEmoji("1️⃣")).toBe(true)
  })

  it("REGRESSION: rejects short non-emoji junk the old length<=4 guard accepted", () => {
    expect(isSingleEmoji("ab!?")).toBe(false)
    expect(isSingleEmoji("a")).toBe(false)
    expect(isSingleEmoji("5")).toBe(false)
    expect(isSingleEmoji(":-)")).toBe(false)
  })

  it("rejects two emoji, emoji+letter, and whitespace-padded emoji", () => {
    expect(isSingleEmoji("🔥🔥")).toBe(false)
    expect(isSingleEmoji("🔥a")).toBe(false)
    expect(isSingleEmoji("🔥 ")).toBe(false)
    expect(isSingleEmoji(" 🔥")).toBe(false)
  })

  it("rejects empty string (optional-field handling lives at the callsite)", () => {
    expect(isSingleEmoji("")).toBe(false)
  })
})
