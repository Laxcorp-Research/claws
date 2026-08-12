import type { ReviewStatus, TrustTier } from "@/generated/prisma/client"
import { isJailExecutionReportRaw } from "@/lib/marketplace/sandbox-jail"

/**
 * Layer-2 sandbox vetting gate. Opt-in via env (staging: set true after
 * SANDBOX_REPORT_TOKEN + SANDBOX_GITHUB_DISPATCH_TOKEN + GHA secrets land).
 */
export function isSandboxVettingEnabled(): boolean {
  return process.env.SANDBOX_VETTING_ENABLED === "true"
}

/** @deprecated Prefer isSandboxVettingEnabled() — kept for call-site grep stability. */
export const SANDBOX_VETTING_ENABLED: boolean =
  typeof process !== "undefined" && process.env.SANDBOX_VETTING_ENABLED === "true"

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
 * VERIFIED requires: flag on + sandboxPassed + jail-quality report
 * (pinned openclaw-runtime dockerImage + real non-SKIPPED agent turn).
 * Simulated / local-grade reports stay SCANNED.
 */
export function resolveCommunityApprovedTrustTier(
  sandboxPassed?: boolean | null,
  sandboxReportRaw?: string | null,
): "SCANNED" | "VERIFIED" {
  if (
    isSandboxVettingEnabled() &&
    sandboxPassed === true &&
    isJailExecutionReportRaw(sandboxReportRaw)
  ) {
    return "VERIFIED"
  }
  return "SCANNED"
}

/** Reject any attempt to mint VERIFIED while sandbox vetting is off. */
export function assertVerifiedMintAllowed(): void {
  if (!isSandboxVettingEnabled()) {
    throw new Error("VERIFIED_UNMINTABLE: sandbox vetting is not configured")
  }
}

/**
 * PR-5: when sandbox vetting is on, refuse approve until sandboxPassed=true.
 */
export function assertSandboxPassedForApprove(sandboxPassed?: boolean | null): void {
  if (!isSandboxVettingEnabled()) return
  if (sandboxPassed !== true) {
    throw new Error("SANDBOX_REQUIRED: sandbox must pass before approve when vetting is enabled")
  }
}
