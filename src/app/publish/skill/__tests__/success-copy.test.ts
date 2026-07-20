/**
 * Batch G — skill publish success copy must match the real pipeline
 * (manual review only; Layer 2 sandbox queue is not configured).
 * MUTATION: restore "Sandbox … queued" claim → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

describe("Skill publish success copy (Batch G)", () => {
  const page = readFileSync(join(ROOT, "src/app/publish/skill/page.tsx"), "utf8")

  it("uses honest submitted-for-manual-review copy", () => {
    expect(page).toContain("Submitted for manual review")
    expect(page).toContain("Not listed until approved")
  })

  it("MUTATION: old sandbox-queued / immediate-list claim must not return", () => {
    expect(page).not.toMatch(/Sandbox test and manual review queued/i)
    expect(page).not.toMatch(/sandbox.*(queued|queue)/i)
    expect(page).not.toMatch(/listed immediately/i)
    expect(page).not.toMatch(/\bsandbox\b/i)
  })
})
