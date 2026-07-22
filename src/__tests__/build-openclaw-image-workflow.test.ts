/**
 * Contract: raw-upstream build must not move :candidate.
 * MUTATION: re-adding `:candidate` to tags → this suite fails.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const WORKFLOW_PATH = resolve(
  __dirname,
  "../../.github/workflows/build-openclaw-image.yml",
)

describe("build-openclaw-image.yml — stop moving :candidate", () => {
  it("STOP_MOVING_CANDIDATE_ASSERT: tags list has immutable version only", () => {
    const yml = readFileSync(WORKFLOW_PATH, "utf8")
    expect(yml).toContain("STOP_MOVING_CANDIDATE_ASSERT")
    // Tag line for :candidate must not appear under tags:
    expect(yml).not.toMatch(
      /tags:\s*\n(?:[^\n]*\n)*?[^\n]*:\$\{\{ env\.REGISTRY \}\}.*?IMAGE_NAME \}\}:candidate/,
    )
    expect(yml).not.toMatch(
      /\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.IMAGE_NAME \}\}:candidate\s*$/m,
    )
  })
})
