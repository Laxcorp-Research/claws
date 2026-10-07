/**
 * fast-uri advisories are cleared by override, never an audit-ci allowlist.
 * GHSA-5jgf-p345-68v8 covers >= 3.1.3 < 3.1.6.
 * GHSA-58mr-gqgx-xq4g is exactly 3.1.6; GHSA-qw65-cvwx-89v3 is >= 3.0.0 < 3.1.7.
 * Floor is 3.1.8.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

describe("fast-uri advisory", () => {
  it("MUTATION: override below 3.1.8 or allowlisting the GHSAs → fail", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      overrides?: Record<string, string>
    }
    const audit = JSON.parse(readFileSync(join(ROOT, "audit-ci.json"), "utf8")) as {
      allowlist?: string[]
    }
    expect(pkg.overrides?.["fast-uri"]).toBe("3.1.8")
    const allow = JSON.stringify(audit.allowlist ?? [])
    expect(allow).not.toContain("GHSA-5jgf-p345-68v8")
    expect(allow).not.toContain("GHSA-58mr-gqgx-xq4g")
    expect(allow).not.toContain("GHSA-qw65-cvwx-89v3")
  })
})
