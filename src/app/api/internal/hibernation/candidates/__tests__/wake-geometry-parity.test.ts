import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("hibernation candidates — P2.3 wake parity", () => {
  it("uses wakeHibernatedWhere + isWakeEligible (no gt:now / 2m clamp dual path)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/hibernation/candidates/route.ts"),
      "utf8",
    )
    expect(src).toContain("wakeHibernatedWhere")
    expect(src).toContain("isWakeEligible")
    expect(src).not.toMatch(/gt:\s*now/)
    expect(src).not.toMatch(/Math\.max\(\s*120_000/)
    expect(src).not.toMatch(/avgWakeDurationMs\s*\*\s*2/)
  })
})
