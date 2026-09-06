/**
 * Lane-gate workflow: PRs targeting main fail unless head.ref is staging.
 *
 * MUTATION: drop the head_ref == staging check (or the LANE_GATE_ASSERT
 * marker) → this file fails.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const WORKFLOW_PATH = resolve(__dirname, "../../.github/workflows/lane-gate.yml")

function loadWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8")
}

describe("lane-gate.yml", () => {
  it("runs on pull_request to main and fails unless head.ref is staging", () => {
    const yml = loadWorkflow()
    expect(yml).toContain("pull_request:")
    expect(yml).toMatch(/branches:\s*\[main\]/)
    expect(yml).toContain("github.head_ref")
    expect(yml).toContain('!= "staging"')
    expect(yml).toContain("LANE_GATE_ASSERT: head_ref_is_staging")
    expect(yml).not.toMatch(/branches:\s*\[main,\s*staging\]/)
  })

  it("MUTATION: source still calls the staging equality (drop → fail)", () => {
    const src = loadWorkflow()
    expect(src).toMatch(/HEAD_REF" != "staging"/)
    expect(src).toContain("Rule 38")
  })
})
