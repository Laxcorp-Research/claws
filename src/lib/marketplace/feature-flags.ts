/**
 * Marketplace posture gates (PR-1). Default OFF until each arc ships.
 *
 * Server routes accept MARKETPLACE_*_ENABLED=true.
 * Client surfaces also accept NEXT_PUBLIC_MARKETPLACE_*_ENABLED=true
 * (bundled at build time for "use client" components).
 */

function envFlagOn(name: string): boolean {
  return process.env[name] === "true"
}

/** Creator publish wizards + POST publish APIs. */
export function isMarketplacePublishEnabled(): boolean {
  return (
    envFlagOn("MARKETPLACE_PUBLISH_ENABLED") ||
    envFlagOn("NEXT_PUBLIC_MARKETPLACE_PUBLISH_ENABLED")
  )
}

/** New creator enrollment (existing CreatorProfile rows stay readable). */
export function isMarketplaceCreatorEnrollEnabled(): boolean {
  return (
    envFlagOn("MARKETPLACE_CREATOR_ENROLL_ENABLED") ||
    envFlagOn("NEXT_PUBLIC_MARKETPLACE_CREATOR_ENROLL_ENABLED")
  )
}

/** Community (creator-owned) paid template checkout + store Buy CTA. */
export function isMarketplaceCommunityPurchaseEnabled(): boolean {
  return (
    envFlagOn("MARKETPLACE_COMMUNITY_PURCHASE_ENABLED") ||
    envFlagOn("NEXT_PUBLIC_MARKETPLACE_COMMUNITY_PURCHASE_ENABLED")
  )
}
