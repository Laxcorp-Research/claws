/**
 * The public Security Audit job fails on high/critical advisories that are
 * not in audit-ci.json. These releases are the patch, so the advisories must
 * stay off the allowlist.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../..")

const PATCHED = [
  "GHSA-2464-fhr4-w9xw",
  "GHSA-673q-mjm6-r5xr",
  "GHSA-cjq9-62q9-8jv4",
  "GHSA-p3m5-59mp-jv5r",
  "GHSA-vcvr-r3jv-pc5j",
  "GHSA-mrhx-c7xc-m3w5",
  "GHSA-mchm-gjx6-7h55",
  "GHSA-2m5v-pch6-74hx",
  "GHSA-qrxm-fqhp-jwvm",
  "GHSA-xjj6-f33q-929c",
] as const

describe("security audit floor", () => {
  it("pins the patched releases and does not allowlist those advisories", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
      overrides: Record<string, string | { zod: string }>
    }
    const audit = JSON.parse(readFileSync(join(ROOT, "audit-ci.json"), "utf8")) as {
      allowlist: string[]
    }

    expect(pkg.dependencies.next).toBe("16.4.1")
    expect(pkg.dependencies.zod).toBe("^4.6.6")
    expect(pkg.dependencies["@sentry/nextjs"]).toBe("^10.75.2")
    expect(pkg.overrides["undici@6"]).toBe("6.29.1")
    expect(pkg.overrides["undici@7"]).toBe("7.30.1")
    expect(pkg.overrides["undici@8"]).toBe("8.12.2")
    expect(pkg.overrides["@vercel/cli-config"]).toEqual({ zod: "4.6.6" })

    for (const id of PATCHED) {
      expect(audit.allowlist, id).not.toContain(id)
    }
  })
})
