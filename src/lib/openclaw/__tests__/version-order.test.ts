import { describe, it, expect } from "vitest"
import {
  parseOpenClawVersion,
  compareOpenClawVersions,
  isNewerVersion,
  extractVersionFromImage,
} from "@/lib/openclaw/version-order"

describe("parseOpenClawVersion", () => {
  it("parses base + -N suffix", () => {
    expect(parseOpenClawVersion("2026.5.22-3")).toEqual({ base: [2026, 5, 22], suffix: 3 })
  })

  it("treats an absent suffix as 0", () => {
    expect(parseOpenClawVersion("2026.5.22")).toEqual({ base: [2026, 5, 22], suffix: 0 })
  })

  it("returns null for unparseable inputs", () => {
    for (const v of ["latest", "candidate", "unknown", "", "2026.5", "2026.5.22.1", "2026.5.22-", "v2026.5.22", "2026.5.22-x"]) {
      expect(parseOpenClawVersion(v)).toBeNull()
    }
  })
})

describe("compareOpenClawVersions — ordering", () => {
  it("ranks a higher date-base as newer", () => {
    expect(compareOpenClawVersions("2026.6.6", "2026.5.22-4")).toBeGreaterThan(0)
    expect(compareOpenClawVersions("2026.5.22-4", "2026.6.6")).toBeLessThan(0)
  })

  it("ranks a -N suffix above the bare base (absent == 0)", () => {
    expect(compareOpenClawVersions("2026.5.22-1", "2026.5.22")).toBeGreaterThan(0)
  })

  it("orders -N suffixes NUMERICALLY incl. multi-digit (-4 > -3, -10 > -9)", () => {
    expect(compareOpenClawVersions("2026.5.22-4", "2026.5.22-3")).toBeGreaterThan(0)
    // The load-bearing multi-digit case: lexical string compare would put "-10"
    // BELOW "-9" ("1" < "9"). Numeric must put -10 above -9.
    expect(compareOpenClawVersions("2026.5.22-10", "2026.5.22-9")).toBeGreaterThan(0)
  })

  it("compares equal versions as 0", () => {
    expect(compareOpenClawVersions("2026.5.22-3", "2026.5.22-3")).toBe(0)
    expect(compareOpenClawVersions("2026.5.22", "2026.5.22")).toBe(0)
  })

  it("sorts the full chain newest→oldest correctly", () => {
    const newestFirst = ["2026.6.6", "2026.5.22-4", "2026.5.22-3", "2026.5.22-2", "2026.5.22"]
    for (let i = 0; i < newestFirst.length - 1; i++) {
      expect(compareOpenClawVersions(newestFirst[i], newestFirst[i + 1])).toBeGreaterThan(0)
    }
    const shuffled = ["2026.5.22-2", "2026.6.6", "2026.5.22", "2026.5.22-4", "2026.5.22-3"]
    // Array.sort is ascending → oldest first → the reverse of newestFirst.
    expect([...shuffled].sort(compareOpenClawVersions)).toEqual([...newestFirst].reverse())
  })
})

describe("compareOpenClawVersions — FAIL-SAFE (unparseable → 0)", () => {
  it("returns exactly 0 when either side is unparseable (both directions)", () => {
    expect(compareOpenClawVersions("latest", "2026.5.22")).toBe(0)
    expect(compareOpenClawVersions("2026.5.22", "latest")).toBe(0)
    expect(compareOpenClawVersions("garbage", "also-garbage")).toBe(0)
  })
})

describe("isNewerVersion", () => {
  it("is true only when target is strictly newer", () => {
    expect(isNewerVersion("2026.5.22-4", "2026.5.22-3")).toBe(true)
    expect(isNewerVersion("2026.5.22-2", "2026.5.22-3")).toBe(false) // older target
    expect(isNewerVersion("2026.5.22-3", "2026.5.22-3")).toBe(false) // equal
  })

  it("FAIL-SAFE: never true when either side is unparseable (no update in either direction)", () => {
    // garbage/unregistered DEPLOYED image must not trigger an update
    expect(isNewerVersion("2026.5.22", "latest")).toBe(false)
    // garbage TARGET must not trigger an update
    expect(isNewerVersion("latest", "2026.5.22")).toBe(false)
  })
})

describe("extractVersionFromImage", () => {
  it("returns the tag after the final colon", () => {
    expect(extractVersionFromImage("ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-3")).toBe("2026.5.22-3")
  })

  it("returns the input unchanged when there is no tag separator", () => {
    expect(extractVersionFromImage("openclaw-runtime")).toBe("openclaw-runtime")
  })
})
