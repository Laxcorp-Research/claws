import type { ReviewStatus, TrustTier } from "@/generated/prisma/client"

/**
 * Layer-2 sandbox vetting is not configured. While false, VERIFIED must not be minted.
 */
export const SANDBOX_VETTING_ENABLED = false

export type PublicVisibilityFields = {
  isPublished: boolean
  trustTier: TrustTier | string
  reviewStatus: ReviewStatus | string
}

/**
 * Official items are exempt from the community reviewStatus gate.
 * Community items require isPublished + reviewStatus=APPROVED.
 */
export function isPubliclyListable(item: PublicVisibilityFields): boolean {
  if (!item.isPublished) return false
  if (item.trustTier === "OFFICIAL") return true
  return item.reviewStatus === "APPROVED"
}

/** Prisma `where` fragment for public template/skill list queries. */
export function publicListingWhere(): {
  isPublished: true
  OR: Array<{ trustTier: "OFFICIAL" } | { reviewStatus: "APPROVED" }>
} {
  return {
    isPublished: true,
    OR: [{ trustTier: "OFFICIAL" }, { reviewStatus: "APPROVED" }],
  }
}

/** SQL AND-fragment for raw FTS queries (alias `t` or `s`). */
export function publicListingSql(alias: "t" | "s"): string {
  return `${alias}."isPublished" = true AND (${alias}."trustTier" = 'OFFICIAL' OR ${alias}."reviewStatus" = 'APPROVED')`
}

/**
 * Trust tier after human admin approve.
 * VERIFIED is unmintable while sandbox vetting is absent — always SCANNED.
 */
export function resolveCommunityApprovedTrustTier(
  _sandboxPassed?: boolean | null,
): "SCANNED" {
  void _sandboxPassed
  if (SANDBOX_VETTING_ENABLED) {
    // Reserved for when Layer-2 sandbox lands; not reachable today.
    throw new Error("SANDBOX_VETTING_ENABLED path not implemented")
  }
  return "SCANNED"
}

/** Reject any attempt to mint VERIFIED while sandbox vetting is off. */
export function assertVerifiedMintAllowed(): void {
  if (!SANDBOX_VETTING_ENABLED) {
    throw new Error("VERIFIED_UNMINTABLE: sandbox vetting is not configured")
  }
}
