import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MONEY_MAKING_TEMPLATES } from "../../../../prisma/seed-data/money-making-templates"
import { parseRecommendedAlwaysOn } from "@/lib/templates/recommended-always-on"

describe("recommendedAlwaysOn template metadata", () => {
  it("Quant Trader seed carries recommendedAlwaysOn: true", () => {
    const quant = MONEY_MAKING_TEMPLATES.find((t) => t.slug === "quant-trader")
    expect(quant).toBeDefined()
    expect(quant?.recommendedAlwaysOn).toBe(true)
  })

  it("parseRecommendedAlwaysOn reads true from snapshot JSON", () => {
    expect(
      parseRecommendedAlwaysOn(JSON.stringify({ recommendedAlwaysOn: true })),
    ).toBe(true)
    expect(
      parseRecommendedAlwaysOn(JSON.stringify({ recommendedAlwaysOn: false })),
    ).toBe(false)
    expect(parseRecommendedAlwaysOn("{}")).toBe(false)
    expect(parseRecommendedAlwaysOn(null)).toBe(false)
  })

  it("MUTATION: seed uses shared snapshot builder that embeds recommendedAlwaysOn", () => {
    const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8")
    expect(seed).toContain("buildWorkspaceSnapshotFromSeedTemplate")
    const builder = readFileSync(
      join(process.cwd(), "src/lib/marketplace/workspace-snapshot.ts"),
      "utf8",
    )
    expect(builder).toContain("recommendedAlwaysOn")
    expect(builder).toContain("template.recommendedAlwaysOn === true")
  })
})
