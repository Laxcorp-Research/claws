import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  assertSandboxPassedForApprove,
  assertVerifiedMintAllowed,
  isSandboxVettingEnabled,
  resolveCommunityApprovedTrustTier,
} from "@/lib/marketplace/public-visibility"

const ROOT = process.cwd()
const FLAG = "SANDBOX_VETTING_ENABLED"

describe("sandbox approve / VERIFIED mint (PR-4/PR-5)", () => {
  afterEach(() => {
    delete process.env[FLAG]
  })

  it("flag off: always SCANNED; assertVerifiedMintAllowed throws", () => {
    delete process.env[FLAG]
    expect(isSandboxVettingEnabled()).toBe(false)
    expect(resolveCommunityApprovedTrustTier(true)).toBe("SCANNED")
    expect(() => assertVerifiedMintAllowed()).toThrow(/VERIFIED_UNMINTABLE/)
    expect(() => assertSandboxPassedForApprove(null)).not.toThrow()
  })

  it("flag on + sandboxPassed=true → VERIFIED", () => {
    process.env[FLAG] = "true"
    expect(resolveCommunityApprovedTrustTier(true)).toBe("VERIFIED")
    expect(() => assertVerifiedMintAllowed()).not.toThrow()
    expect(() => assertSandboxPassedForApprove(true)).not.toThrow()
  })

  it("flag on + sandboxPassed false/null → refuse approve + SCANNED tier", () => {
    process.env[FLAG] = "true"
    expect(resolveCommunityApprovedTrustTier(false)).toBe("SCANNED")
    expect(resolveCommunityApprovedTrustTier(null)).toBe("SCANNED")
    expect(() => assertSandboxPassedForApprove(false)).toThrow(/SANDBOX_REQUIRED/)
    expect(() => assertSandboxPassedForApprove(null)).toThrow(/SANDBOX_REQUIRED/)
  })

  it("MUTATION: approve-mints-VERIFIED-without-sandbox restored → fails", () => {
    const skillApprove = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/skills/[id]/approve/route.ts"),
      "utf8",
    )
    expect(skillApprove).toContain("assertSandboxPassedForApprove")
    expect(skillApprove).toContain("SANDBOX_REQUIRED")
    expect(skillApprove).toContain("resolveCommunityApprovedTrustTier")
    // Must not mint VERIFIED from a bare ternary / hardcode on the update data.
    expect(skillApprove).not.toMatch(/sandboxPassed\s*\?\s*['"]VERIFIED['"]/)
    expect(skillApprove).toContain("trustTier: newTier")
    expect(skillApprove).not.toContain('trustTier: "VERIFIED"')
    expect(skillApprove).not.toContain("trustTier: 'VERIFIED'")
  })

  it("MUTATION: TrustBadgeLegend Verified copy locked", () => {
    const src = readFileSync(join(ROOT, "src/components/marketplace/trust-badge.tsx"), "utf8")
    expect(src).toContain(
      "Verified — ran in an isolated sandbox (no credentials, network locked to the AI model)",
    )
  })
})
