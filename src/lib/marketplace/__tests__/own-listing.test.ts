import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isOwnListing, ownListingMessage } from "@/lib/marketplace/own-listing"

describe("isOwnListing", () => {
  it("true only when creator user id equals buyer user id", () => {
    expect(isOwnListing("user-1", "user-1")).toBe(true)
    expect(isOwnListing("user-1", "user-2")).toBe(false)
  })

  it("false when comparing buyer to CreatorProfile.id (production shape)", () => {
    // template.creatorId is a profile cuid, not the user id.
    expect(isOwnListing(undefined, "user-1")).toBe(false)
    expect(isOwnListing(null, "user-1")).toBe(false)
    expect(isOwnListing("", "user-1")).toBe(false)
  })
})

describe("ownListingMessage", () => {
  it("UI copy", () => {
    expect(ownListingMessage("template")).toBe("This is your template")
    expect(ownListingMessage("skill")).toBe("This is your skill")
  })

  it("MUTATION: UI strings changed → fail", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/marketplace/own-listing.ts"), "utf8")
    expect(src).toContain('"This is your template"')
    expect(src).toContain('"This is your skill"')
  })
})
