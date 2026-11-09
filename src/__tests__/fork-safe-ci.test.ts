import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("fork-safe CI", () => {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8")

  it("runs e2e from a service-container Postgres and Redis with no repository secrets", () => {
    const e2e = ci.slice(ci.indexOf("e2e-tests:"), ci.indexOf("security:"))
    expect(e2e).not.toContain("secrets.TEST_DATABASE_URL")
    expect(e2e).not.toContain("secrets.TEST_DIRECT_URL")
    expect(e2e).not.toContain("head.repo.full_name")
    expect(e2e).toContain("image: postgres:16")
    expect(e2e).toContain("image: redis:7")
    expect(e2e).toContain("npx prisma migrate reset --force")
  })

  it("keeps the quality lane on every pull request (no fork skip)", () => {
    const quality = ci.slice(ci.indexOf("quality:"), ci.indexOf("unit-tests:"))
    expect(quality).not.toContain("head.repo.full_name")
  })
})
