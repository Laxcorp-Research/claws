/**
 * Marketplace posture gates (PR-1). Default OFF until each arc ships.
 *
 * Server routes accept MARKETPLACE_*_ENABLED=true.
 * Client surfaces also accept NEXT_PUBLIC_MARKETPLACE_*_ENABLED=true
 * (bundled at build time for "use client" components).
 *
 * Use process.env.NAME (dot form) so VERCEL_ENV_MANIFEST surface scanning
 * can prove each flag has a reader.
 */

/** Creator publish wizards + POST publish APIs. */
export function isMarketplacePublishEnabled(): boolean {
  return (
    process.env.MARKETPLACE_PUBLISH_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_MARKETPLACE_PUBLISH_ENABLED === "true"
  )
}

/** New creator enrollment (existing CreatorProfile rows stay readable). */
export function isMarketplaceCreatorEnrollEnabled(): boolean {
  return (
    process.env.MARKETPLACE_CREATOR_ENROLL_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_MARKETPLACE_CREATOR_ENROLL_ENABLED === "true"
  )
}

/** Community (creator-owned) paid template checkout + store Buy CTA. */
export function isMarketplaceCommunityPurchaseEnabled(): boolean {
  return (
    process.env.MARKETPLACE_COMMUNITY_PURCHASE_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_MARKETPLACE_COMMUNITY_PURCHASE_ENABLED === "true"
  )
}
