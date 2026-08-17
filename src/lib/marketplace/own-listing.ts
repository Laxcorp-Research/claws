/** Listing owner is CreatorProfile.userId, not CreatorProfile.id. */
export const OWN_LISTING_CODE = "OWN_LISTING" as const

export function isOwnListing(
  creatorUserId: string | null | undefined,
  buyerUserId: string,
): boolean {
  return typeof creatorUserId === "string" && creatorUserId.length > 0 && creatorUserId === buyerUserId
}

export function ownListingMessage(kind: "template" | "skill"): string {
  return kind === "skill" ? "This is your skill" : "This is your template"
}
