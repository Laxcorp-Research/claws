/**
 * GHSA-5jgf-p345-68v8 / CVE-2026-75931: fast-uri >= 3.1.3 < 3.1.6.
 * Clear by override, never audit-ci allowlist.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

describe("fast-uri advisory", () => {
  it("MUTATION: override below 3.1.6 or allowlisting the GHSA → fail", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      overrides?: Record<string, string>
    }
    const audit = JSON.parse(readFileSync(join(ROOT, "audit-ci.json"), "utf8")) as {
      allowlist?: string[]
    }
    expect(pkg.overrides?.["fast-uri"]).toBe("3.1.6")
    expect(JSON.stringify(audit.allowlist ?? [])).not.toContain("GHSA-5jgf-p345-68v8")
  })
})
