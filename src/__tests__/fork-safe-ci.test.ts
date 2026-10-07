import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("fork-safe CI", () => {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8")

  it("skips the Neon e2e job on pull requests from forks", () => {
    const e2e = ci.slice(ci.indexOf("e2e-tests:"), ci.indexOf("security:"))
    expect(e2e).toContain("github.event.pull_request.head.repo.full_name == github.repository")
  })

  it("keeps the quality lane on every pull request (no fork skip)", () => {
    const quality = ci.slice(ci.indexOf("quality:"), ci.indexOf("unit-tests:"))
    expect(quality).not.toContain("head.repo.full_name")
  })
})
