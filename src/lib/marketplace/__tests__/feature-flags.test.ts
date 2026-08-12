import { afterEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  isMarketplaceCommunityPurchaseEnabled,
  isMarketplaceCreatorEnrollEnabled,
  isMarketplacePublishEnabled,
} from "@/lib/marketplace/feature-flags"

const FLAG_KEYS = [
  "MARKETPLACE_PUBLISH_ENABLED",
  "NEXT_PUBLIC_MARKETPLACE_PUBLISH_ENABLED",
  "MARKETPLACE_CREATOR_ENROLL_ENABLED",
  "NEXT_PUBLIC_MARKETPLACE_CREATOR_ENROLL_ENABLED",
  "MARKETPLACE_COMMUNITY_PURCHASE_ENABLED",
  "NEXT_PUBLIC_MARKETPLACE_COMMUNITY_PURCHASE_ENABLED",
] as const

function clearFlags() {
  for (const key of FLAG_KEYS) delete process.env[key]
}

describe("PR-1 marketplace posture flags", () => {
  afterEach(() => {
    clearFlags()
  })

  it("defaults OFF when unset", () => {
    clearFlags()
    expect(isMarketplacePublishEnabled()).toBe(false)
    expect(isMarketplaceCreatorEnrollEnabled()).toBe(false)
    expect(isMarketplaceCommunityPurchaseEnabled()).toBe(false)
  })

  it("flag-on restores publish / enroll / community purchase", () => {
    clearFlags()
    process.env.MARKETPLACE_PUBLISH_ENABLED = "true"
    process.env.MARKETPLACE_CREATOR_ENROLL_ENABLED = "true"
    process.env.MARKETPLACE_COMMUNITY_PURCHASE_ENABLED = "true"
    expect(isMarketplacePublishEnabled()).toBe(true)
    expect(isMarketplaceCreatorEnrollEnabled()).toBe(true)
    expect(isMarketplaceCommunityPurchaseEnabled()).toBe(true)
  })

  it("accepts NEXT_PUBLIC_ client flags", () => {
    clearFlags()
    process.env.NEXT_PUBLIC_MARKETPLACE_PUBLISH_ENABLED = "true"
    expect(isMarketplacePublishEnabled()).toBe(true)
  })

  it("MUTATION: publish layouts gate behind isMarketplacePublishEnabled", () => {
    const templateLayout = readFileSync(
      join(process.cwd(), "src/app/publish/template/layout.tsx"),
      "utf8",
    )
    const skillLayout = readFileSync(
      join(process.cwd(), "src/app/publish/skill/layout.tsx"),
      "utf8",
    )
    expect(templateLayout).toContain("isMarketplacePublishEnabled")
    expect(templateLayout).toContain("MarketplaceComingSoonPanel")
    expect(skillLayout).toContain("isMarketplacePublishEnabled")
    expect(skillLayout).toContain("MarketplaceComingSoonPanel")
  })

  it("MUTATION: publish + enroll + community APIs check COMING_SOON gates", () => {
    const files = [
      "src/app/api/marketplace/templates/route.ts",
      "src/app/api/marketplace/skills/route.ts",
      "src/app/api/creator/enroll/route.ts",
      "src/app/api/dodo-payments/checkout/route.ts",
    ]
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      expect(src, rel).toContain("COMING_SOON")
    }
    expect(
      readFileSync(join(process.cwd(), "src/app/api/dodo-payments/checkout/route.ts"), "utf8"),
    ).toContain("isMarketplaceCommunityPurchaseEnabled")
    expect(
      readFileSync(join(process.cwd(), "src/app/api/creator/enroll/route.ts"), "utf8"),
    ).toContain("isMarketplaceCreatorEnrollEnabled")
  })

  it("MUTATION: creator dashboard + store CTA use flags (remove gate → fail)", () => {
    const creator = readFileSync(
      join(process.cwd(), "src/components/settings/creator-dashboard.tsx"),
      "utf8",
    )
    const store = readFileSync(
      join(process.cwd(), "src/app/store/[slug]/page.tsx"),
      "utf8",
    )
    expect(creator).toContain("isMarketplaceCreatorEnrollEnabled")
    expect(creator).toContain("isMarketplacePublishEnabled")
    expect(creator).toContain("MarketplaceComingSoonPanel")
    expect(store).toContain("isMarketplaceCommunityPurchaseEnabled")
    expect(store).toContain("Purchase coming soon")
  })
})
