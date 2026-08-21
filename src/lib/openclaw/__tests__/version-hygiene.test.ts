import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isNeverPromotableVersion,
  isPromotableClawsRebuild,
  neverPromotableReason,
  selectLatestVersionId,
  SEED_RELIC_VERSION,
} from "@/lib/openclaw/version-hygiene"
import { compareOpenClawVersions } from "@/lib/openclaw/version-order"

describe("version-hygiene - never-promotable", () => {
  it("marks 2.5.0 seed relic", () => {
    expect(SEED_RELIC_VERSION).toBe("2.5.0")
    expect(isNeverPromotableVersion("2.5.0")).toBe(true)
    expect(neverPromotableReason("2.5.0")).toMatch(/seed relic/)
  })

  it("marks raw-calendar bare YYYY.M.D (e.g. 2026.7.1)", () => {
    expect(isNeverPromotableVersion("2026.7.1")).toBe(true)
    expect(neverPromotableReason("2026.7.1")).toMatch(/raw-calendar/)
    expect(isPromotableClawsRebuild("2026.7.1")).toBe(false)
  })

  it("marks raw-calendar placeholder 2026.6.x", () => {
    expect(isNeverPromotableVersion("2026.6.x")).toBe(true)
    expect(neverPromotableReason("2026.6.x")).toMatch(/placeholder|raw-calendar/)
  })

  it("allows claws rebuild YYYY.M.D-N (e.g. 2026.5.22-9)", () => {
    expect(isNeverPromotableVersion("2026.5.22-9")).toBe(false)
    expect(isPromotableClawsRebuild("2026.5.22-9")).toBe(true)
    expect(neverPromotableReason("2026.5.22-9")).toBeNull()
  })

  it("MUTATION: guard absent → promotable-junk would pass (bare calendar)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/openclaw/version-hygiene.ts"),
      "utf8",
    )
    expect(src).toContain("raw-calendar")
    expect(src).toContain("SEED_RELIC_VERSION")
    expect(src).toContain(String.raw`^\d{4}\.\d+\.\d+$`)
    // Simulate buggy "everything with digits is fine"
    const buggyAllowsBare = /^\d/.test("2026.7.1")
    expect(buggyAllowsBare).toBe(true)
    expect(isNeverPromotableVersion("2026.7.1")).toBe(true)
  })
})

describe("selectLatestVersionId - exclude never-promotable", () => {
  it("picks highest claws rebuild even when bare-calendar ranks higher", () => {
    // 2026.7.1 > 2026.5.22-9 by comparator, but never-promotable.
    const id = selectLatestVersionId([
      { id: "bare", version: "2026.7.1" },
      { id: "rebuild", version: "2026.5.22-9" },
      { id: "seed", version: "2.5.0" },
    ])
    expect(id).toBe("rebuild")
  })

  it("returns null when every row is never-promotable", () => {
    expect(
      selectLatestVersionId([
        { id: "a", version: "2.5.0" },
        { id: "b", version: "2026.7.1" },
      ]),
    ).toBeNull()
  })

  it("MUTATION: filter absent → bare calendar would win Latest", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/openclaw/version-hygiene.ts"),
      "utf8",
    )
    expect(src).toMatch(/!isNeverPromotableVersion/)
    const rows = [
      { id: "bare", version: "2026.7.1" },
      { id: "rebuild", version: "2026.5.22-9" },
    ]
    // Buggy reduce-without-filter picks bare (higher by comparator).
    const buggy = rows.reduce((newest, v) =>
      compareOpenClawVersions(v.version, newest.version) > 0 ? v : newest,
    )
    expect(buggy.id).toBe("bare")
    expect(selectLatestVersionId(rows)).toBe("rebuild")
  })
})
