import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertVerifiedMintAllowed,
  isPubliclyListable,
  publicListingSql,
  publicListingWhere,
  resolveCommunityApprovedTrustTier,
  SANDBOX_VETTING_ENABLED,
} from "@/lib/marketplace/public-visibility"

const ROOT = process.cwd()

describe("public listing visibility (Arc 1)", () => {
  it("official published items are listable regardless of reviewStatus", () => {
    expect(
      isPubliclyListable({
        isPublished: true,
        trustTier: "OFFICIAL",
        reviewStatus: "PENDING",
      }),
    ).toBe(true)
  })

  it("community PENDING is not listable even if isPublished true", () => {
    expect(
      isPubliclyListable({
        isPublished: true,
        trustTier: "UNREVIEWED",
        reviewStatus: "PENDING",
      }),
    ).toBe(false)
  })

  it("community APPROVED + published is listable", () => {
    expect(
      isPubliclyListable({
        isPublished: true,
        trustTier: "SCANNED",
        reviewStatus: "APPROVED",
      }),
    ).toBe(true)
  })

  it("unpublished community APPROVED is not listable", () => {
    expect(
      isPubliclyListable({
        isPublished: false,
        trustTier: "SCANNED",
        reviewStatus: "APPROVED",
      }),
    ).toBe(false)
  })

  it("publicListingWhere requires APPROVED for community (official exempt via OR)", () => {
    const where = publicListingWhere()
    expect(where.isPublished).toBe(true)
    expect(where.OR).toEqual([
      { trustTier: "OFFICIAL" },
      { reviewStatus: "APPROVED" },
    ])
  })

  it("MUTATION: drop the community APPROVED filter → fail", () => {
    const src = readFileSync(join(ROOT, "src/lib/marketplace/public-visibility.ts"), "utf8")
    expect(src).toContain('reviewStatus: "APPROVED"')
    expect(src).toContain('trustTier: "OFFICIAL"')
    expect(publicListingSql("t")).toMatch(/reviewStatus.*=.*'APPROVED'/)
    // If someone reverts to isPublished-only, this assertion fails.
    expect(publicListingSql("t")).not.toBe('t."isPublished" = true')
  })
})

describe("VERIFIED mint block while sandbox absent (Arc 1)", () => {
  it("resolveCommunityApprovedTrustTier always returns SCANNED while sandbox off", () => {
    expect(SANDBOX_VETTING_ENABLED).toBe(false)
    expect(resolveCommunityApprovedTrustTier(true)).toBe("SCANNED")
    expect(resolveCommunityApprovedTrustTier(false)).toBe("SCANNED")
    expect(resolveCommunityApprovedTrustTier(null)).toBe("SCANNED")
  })

  it("assertVerifiedMintAllowed rejects while sandbox absent", () => {
    expect(() => assertVerifiedMintAllowed()).toThrow(/VERIFIED_UNMINTABLE/)
  })

  it("MUTATION: allow VERIFIED mint on skill approve → fail", () => {
    const skillApprove = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/skills/[id]/approve/route.ts"),
      "utf8",
    )
    const templateApprove = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/templates/[id]/approve/route.ts"),
      "utf8",
    )
    expect(skillApprove).not.toMatch(/sandboxPassed\s*\?\s*['"]VERIFIED['"]/)
    expect(skillApprove).not.toMatch(/trustTier:\s*['"]VERIFIED['"]/)
    expect(templateApprove).not.toMatch(/trustTier:\s*['"]VERIFIED['"]/)
    expect(skillApprove).toContain("resolveCommunityApprovedTrustTier")
    expect(templateApprove).toContain("resolveCommunityApprovedTrustTier")
    expect(skillApprove).toContain("assertVerifiedMintAllowed")
    expect(skillApprove).toContain("VERIFIED_UNMINTABLE")
  })

  it("MUTATION: reject keeps published → fail (must set isPublished false)", () => {
    const templateReject = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/templates/[id]/reject/route.ts"),
      "utf8",
    )
    const skillReject = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/skills/[id]/reject/route.ts"),
      "utf8",
    )
    expect(templateReject).toMatch(/isPublished:\s*false/)
    expect(skillReject).toMatch(/isPublished:\s*false/)
  })
})
