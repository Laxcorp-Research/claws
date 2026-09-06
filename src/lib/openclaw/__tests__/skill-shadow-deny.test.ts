import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  SKILL_SHADOWS_BUNDLED_TOOLS,
  bundledToolsShadowedBySkills,
  collectAttachedSkillSlugs,
  disableBundledWebSearch,
  mergeSkillShadowDenyIntoTools,
} from "@/lib/openclaw/skill-shadow-deny"

describe("skill-shadow deny", () => {
  it("tavily-search and brave-search both shadow web_search", () => {
    expect(SKILL_SHADOWS_BUNDLED_TOOLS["tavily-search"]).toContain("web_search")
    expect(SKILL_SHADOWS_BUNDLED_TOOLS["brave-search"]).toContain("web_search")
    expect(bundledToolsShadowedBySkills(["tavily-search"])).toEqual(["web_search"])
    expect(bundledToolsShadowedBySkills(["brave-search", "tavily-search"])).toEqual([
      "web_search",
    ])
    expect(bundledToolsShadowedBySkills(["alpaca-trading"])).toEqual([])
  })

  it("collects attached skill slugs across agents", () => {
    const slugs = collectAttachedSkillSlugs({
      agents: [
        { skills: [{ skill: { slug: "tavily-search" } }] },
        { skills: [{ skill: { slug: "alpaca-trading" } }, { skill: { slug: "tavily-search" } }] },
        { skills: [] },
      ],
    })
    expect(slugs.sort()).toEqual(["alpaca-trading", "tavily-search"])
  })

  it("merges web_search into tools.deny without clobbering", () => {
    const tools = mergeSkillShadowDenyIntoTools({ deny: ["dir_list"] }, ["tavily-search"])
    expect(tools.deny).toEqual(expect.arrayContaining(["dir_list", "web_search"]))
  })

  it("disables tools.web.search.enabled", () => {
    const tools = disableBundledWebSearch({ deny: ["web_search"] })
    const web = tools.web as { search?: { enabled?: boolean } }
    expect(web.search?.enabled).toBe(false)
    expect(tools.deny).toEqual(["web_search"])
  })
})

describe("skill-shadow deny mutations", () => {
  it("MUTATION: generator still merges skill-shadow deny (drop → fail)", () => {
    const generator = readFileSync(
      resolve(__dirname, "../generator.ts"),
      "utf8",
    )
    expect(generator).toContain("mergeSkillShadowDenyIntoTools")
    expect(generator).toContain("collectAttachedSkillSlugs")
    expect(generator).toContain("disableBundledWebSearch")
  })
})
