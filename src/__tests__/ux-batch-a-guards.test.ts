/**
 * Batch A recurrence guards (money/catalog lies).
 * MUTATION: reverse any locked shape → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

describe("Batch A recurrence guards", () => {
  it("skills-search-includes-Official: search hook has no section:popular", () => {
    const src = read("src/app/store/page.tsx")
    // skillSearch must exist without section popular
    expect(src).toContain("skillSearch")
    expect(src).toMatch(
      /skillSearch\s*=\s*useMarketplace<MarketplaceSkill>\(\s*filters,\s*\{\s*type:\s*"skills",\s*initialLimit/,
    )
    // When searching, popularSkills must be disabled
    expect(src).toMatch(
      /section:\s*"popular"[\s\S]*?enabled:\s*isSkillsTab\s*&&\s*!isSearchActive/,
    )
  })

  it("pricing-single-source: no static claw-templates import; fetches marketplace API", () => {
    const src = read("src/app/pricing/page.tsx")
    expect(src).not.toMatch(/CLAW_TEMPLATES/)
    expect(src).not.toContain("@/data/claw-templates")
    expect(src).toContain("/api/marketplace/templates")
  })

  it("billing-uses-runningClaws: estimate from data.runningClaws, not PAUSED filter math", () => {
    const src = read("src/components/settings/billing-dashboard.tsx")
    expect(src).toContain("data.runningClaws")
    expect(src).toMatch(/runningClaws\s*\*\s*79/)
    expect(src).not.toMatch(
      /filter\(\(w\)\s*=>\s*w\.status\s*===\s*"RUNNING"\s*\|\|\s*w\.status\s*===\s*"PAUSED"\)[\s\S]*\*\s*79/,
    )
    expect(src).toContain("running Claw")
    expect(src).not.toMatch(/Stripe/i)
  })

  it("install-success copy fixture: redeploy-carries honesty (no false hot-add)", () => {
    const src = read("src/app/store/skills/[slug]/page.tsx")
    expect(src).not.toContain("available to all agents")
    expect(src).not.toContain("Runtime hot-add is pending")
    expect(src).toContain("Applies on next redeploy")
    expect(src).toContain("community_purchase")
  })

  it("paid-install-entitlement: install route checks MarketplaceSale", () => {
    const src = read("src/app/api/marketplace/skills/[slug]/install/route.ts")
    expect(src).toContain("marketplaceSale.findFirst")
    expect(src).toContain("PURCHASE_REQUIRED")
  })

  it("no-$NaN: template detail uses formatEstimatedMonthlyTotal", () => {
    const src = read("src/app/store/[slug]/page.tsx")
    expect(src).toContain("formatEstimatedMonthlyTotal")
    expect(src).not.toMatch(/Number\(template\.estimatedMonthlyCost\)\s*\+\s*79/)
  })
})
