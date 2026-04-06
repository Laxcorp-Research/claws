import { describe, it, expect } from "vitest"
import { ALL_TOOLS } from "@/data/tool-catalog"

describe("Tool catalog (static fallback)", () => {
  it("includes API key and OAuth tools", () => {
    const apiKeyTools = ALL_TOOLS.filter((t) => t.connectionType === "API_KEY")
    const oauthTools = ALL_TOOLS.filter((t) => t.connectionType === "OAUTH_COMPOSIO")
    expect(apiKeyTools.length).toBeGreaterThan(10)
    expect(oauthTools.length).toBeGreaterThan(10)
  })

  it("includes key slugs", () => {
    const slugs = ALL_TOOLS.map((t) => t.slug)
    expect(slugs).toContain("tavily")
    expect(slugs).toContain("gmail")
    expect(slugs).toContain("hubspot")
  })
})
