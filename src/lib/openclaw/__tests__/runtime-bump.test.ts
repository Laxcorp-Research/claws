import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ORPHAN_CANDIDATE_VERSIONS,
  classifyRuntimeBump,
  mayAutoPromoteOverlayN,
  upstreamDateTuple,
} from "@/lib/openclaw/runtime-bump"

describe("classifyRuntimeBump", () => {
  it("overlay -N: same date tuple and same buildSourceTag", () => {
    expect(
      classifyRuntimeBump(
        { version: "2026.5.22-18", buildSourceTag: "v2026.5.22" },
        { version: "2026.5.22-19", buildSourceTag: "v2026.5.22" },
      ),
    ).toBe("overlay-N")
    expect(mayAutoPromoteOverlayN("overlay-N")).toBe(true)
  })

  it("date-tuple: 5.22 -> 9.4 is founder ACK, never auto", () => {
    expect(
      classifyRuntimeBump(
        { version: "2026.5.22-18", buildSourceTag: "v2026.5.22" },
        { version: "2026.9.4", buildSourceTag: "v2026.9.4" },
      ),
    ).toBe("date-tuple")
    expect(mayAutoPromoteOverlayN("date-tuple")).toBe(false)
  })

  it("upstream-revision: same YYYY.M.D, different source tag", () => {
    expect(
      classifyRuntimeBump(
        { version: "2026.7.1", buildSourceTag: "v2026.7.1" },
        { version: "2026.7.1-2", buildSourceTag: "v2026.7.1-2" },
      ),
    ).toBe("upstream-revision")
    expect(mayAutoPromoteOverlayN("upstream-revision")).toBe(false)
  })

  it("upstreamDateTuple strips overlay suffix", () => {
    expect(upstreamDateTuple("2026.5.22-18")).toBe("2026.5.22")
    expect(upstreamDateTuple("2026.9.4")).toBe("2026.9.4")
  })

  it("MUTATION: orphan supersede SQL lists all six historical candidates", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260912133000_runtime_autoupdate_lane/migration.sql",
      ),
      "utf8",
    )
    expect(sql).toContain("supersededAt")
    for (const version of ORPHAN_CANDIDATE_VERSIONS) {
      expect(sql).toContain(`'${version}'`)
    }
    expect(sql).not.toContain("'2026.9.4'")
  })
})
