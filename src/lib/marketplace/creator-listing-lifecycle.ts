/**
 * Creator listing lifecycle: unpublish anytime; delete only at zero sales
 * and zero installs. Buyers keep snapshot copies on their workspaces.
 */

export type ListingTradeCounts = {
  salesCount: number
  installCount: number
}

/**
 * DELETE predicate (quote in tests/PRs):
 * salesCount === 0 && installCount === 0
 */
export function canDeleteCreatorListing(counts: ListingTradeCounts): boolean {
  return counts.salesCount === 0 && counts.installCount === 0
}

export function deleteBlockedCopy(counts: ListingTradeCounts): string {
  if (counts.installCount > 0) {
    const n = counts.installCount
    const people = n === 1 ? "1 person" : `${n} people`
    return `${people} installed this - you can unpublish but not delete`
  }
  if (counts.salesCount > 0) {
    const n = counts.salesCount
    return `${n} ${n === 1 ? "sale" : "sales"} - you can unpublish but not delete`
  }
  return "You can unpublish but not delete"
}

export function creatorListingStatusLabel(item: {
  isPublished: boolean
  reviewStatus: string
}): string {
  if (item.isPublished) return "Published"
  if (item.reviewStatus === "REJECTED") return "Rejected"
  if (item.reviewStatus === "PENDING") return "Under Review"
  if (item.reviewStatus === "APPROVED") return "Unpublished"
  return "Under Review"
}

export function creatorListingStatusClass(item: {
  isPublished: boolean
  reviewStatus: string
}): string {
  if (item.isPublished) return "text-[var(--ok)]"
  if (item.reviewStatus === "REJECTED") return "text-[var(--err)]"
  if (item.reviewStatus === "APPROVED") return "text-[var(--tx2)]"
  return "text-[var(--warn)]"
}

export const UNPUBLISHED_LISTING_STATE = "unpublished" as const

export type UnpublishedListing = {
  listingState: typeof UNPUBLISHED_LISTING_STATE
  name: string
  slug: string
}

export function unpublishedListing(name: string, slug: string): UnpublishedListing {
  return { listingState: UNPUBLISHED_LISTING_STATE, name, slug }
}

export function isUnpublishedListing(data: unknown): data is UnpublishedListing {
  if (!data || typeof data !== "object") return false
  return (data as UnpublishedListing).listingState === UNPUBLISHED_LISTING_STATE
}

/** Owner-only store payload for a listing they unpublished (still APPROVED). */
export function ownerMaySeeUnpublished(opts: {
  publiclyListable: boolean
  reviewStatus: string
  viewerUserId?: string | null
  creatorUserId?: string | null
}): boolean {
  if (opts.publiclyListable) return false
  if (opts.reviewStatus !== "APPROVED") return false
  if (!opts.viewerUserId || !opts.creatorUserId) return false
  return opts.viewerUserId === opts.creatorUserId
}
