import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  canDeleteCreatorListing,
  creatorListingStatusLabel,
  deleteBlockedCopy,
  ownerMaySeeUnpublished,
} from "@/lib/marketplace/creator-listing-lifecycle"

const ROOT = process.cwd()

describe("canDeleteCreatorListing — sales+installs predicate", () => {
  it("0 sales delete ok", () => {
    expect(canDeleteCreatorListing({ salesCount: 0, installCount: 0 })).toBe(true)
  })

  it(">0 installs blocked", () => {
    expect(canDeleteCreatorListing({ salesCount: 0, installCount: 3 })).toBe(false)
    expect(deleteBlockedCopy({ salesCount: 0, installCount: 3 })).toBe(
      "3 people installed this — you can unpublish but not delete",
    )
  })

  it("1 install uses singular copy", () => {
    expect(deleteBlockedCopy({ salesCount: 0, installCount: 1 })).toBe(
      "1 person installed this — you can unpublish but not delete",
    )
  })

  it(">0 sales blocked even with 0 installs", () => {
    expect(canDeleteCreatorListing({ salesCount: 2, installCount: 0 })).toBe(false)
  })

  it("unpublish is not gated by the delete predicate", () => {
    // Unpublish is always allowed for the owner; the predicate only guards DELETE.
    expect(canDeleteCreatorListing({ salesCount: 9, installCount: 9 })).toBe(false)
    expect(canDeleteCreatorListing({ salesCount: 0, installCount: 0 })).toBe(true)
  })

  it("quotes the predicate in source", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/marketplace/creator-listing-lifecycle.ts"),
      "utf8",
    )
    expect(src).toContain("salesCount === 0 && installCount === 0")
  })
})

describe("owner unpublished store payload", () => {
  it("owner of unpublished APPROVED listing may see unpublished state", () => {
    expect(
      ownerMaySeeUnpublished({
        publiclyListable: false,
        reviewStatus: "APPROVED",
        viewerUserId: "u-1",
        creatorUserId: "u-1",
      }),
    ).toBe(true)
  })

  it("stranger cannot see unpublished listing", () => {
    expect(
      ownerMaySeeUnpublished({
        publiclyListable: false,
        reviewStatus: "APPROVED",
        viewerUserId: "stranger",
        creatorUserId: "u-1",
      }),
    ).toBe(false)
  })

  it("PENDING stays on the pending-review path, not unpublished", () => {
    expect(
      ownerMaySeeUnpublished({
        publiclyListable: false,
        reviewStatus: "PENDING",
        viewerUserId: "u-1",
        creatorUserId: "u-1",
      }),
    ).toBe(false)
  })
})

describe("creator dashboard status labels", () => {
  it("labels unpublished APPROVED as Unpublished", () => {
    expect(creatorListingStatusLabel({ isPublished: false, reviewStatus: "APPROVED" })).toBe(
      "Unpublished",
    )
  })
})
