import { describe, it, expect } from "vitest"
import { ALL_TOOLS } from "@/data/tool-catalog"
import { TOOL_SPECIFIC_SKILLS } from "../../../prisma/seed-data/skills-tool-specific"

// The 4 drifted forms that used to live in the catalog and have been renamed
// to match the kebab-case convention used everywhere else (seeds, templates,
// marketplace). See GH #27, docs/TOOL_CONNECTION_FIX_INVESTIGATION.md §2.
const DRIFT_FORMS = ["twitter_api", "youtube_data", "gsc", "google_analytics"] as const

// The 4 canonical forms after the rename. Same set as DRIFT_FORMS, just in
// their corrected shape.
const CANONICAL_FORMS = [
  "twitter-api",
  "youtube-data-api",
  "google-search-console",
  "google-analytics",
] as const

// GH #28 tracks the remaining underscore-form catalog slugs that live
// outside this PR's scope. They have no parallel kebab-case form in seeds
// drifting away from them — they're just unconventional slug names. The
// kebab-case-everywhere test below allows these explicitly so day-one
// landing is green; widening the rename is a separate product decision.
//
// Roughly two groups:
//   - API_KEY tools we authored (anthropic_api, serp_api, exa_search,
//     brave_search, cal_com, stripe_api)
//   - OAUTH_COMPOSIO tools whose slug mirrors Composio's toolkit id
//     (google_calendar — Composio's own naming). See GH #28 for the
//     Composio dynamic catalog normalization question.
const KEBAB_CASE_EXCEPTIONS = [
  "anthropic_api",
  "serp_api",
  "exa_search",
  "brave_search",
  "cal_com",
  "stripe_api",
  "google_calendar",
] as const
const KEBAB_CASE_EXCEPTIONS_SET = new Set<string>(KEBAB_CASE_EXCEPTIONS)

// Orphan slugs referenced by seed compatibleTools that have no catalog
// entry. Not drift — different problem class. Tracked in
// docs/TOOL_CONNECTION_FIX_INVESTIGATION.md §2 line 144. Allowed here so
// the seed cross-reference test stays green while the orphan disposition
// is decided in its own PR.
const KNOWN_ORPHAN_COMPATIBLE_TOOLS = new Set<string>([
  "pipedrive",
  "smartlead",
  "typefully",
  "coinbase",
  "snyk",
  "zillow",
  "google-business-profile",
])

describe("tool catalog slug drift (GH #27)", () => {
  it("catalog contains no drift forms", () => {
    const offenders = ALL_TOOLS.filter((t) =>
      (DRIFT_FORMS as readonly string[]).includes(t.slug),
    )
    expect(
      offenders,
      `Drift forms still present in catalog: ${offenders
        .map((o) => o.slug)
        .join(", ")}. Rename them to their canonical kebab-case form.`,
    ).toHaveLength(0)
  })

  it("all 4 canonical forms are present in catalog", () => {
    for (const canonical of CANONICAL_FORMS) {
      const hit = ALL_TOOLS.find((t) => t.slug === canonical)
      expect(hit, `Expected catalog to contain slug='${canonical}'`).toBeDefined()
    }
  })

  it("every catalog slug is kebab-case (soft — known exceptions tracked in GH #28)", () => {
    const kebabRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/
    const offenders = ALL_TOOLS
      .map((t) => t.slug)
      .filter((slug) => !kebabRegex.test(slug))
      .filter((slug) => !KEBAB_CASE_EXCEPTIONS_SET.has(slug))

    expect(
      offenders,
      `Catalog slugs failing kebab-case that are NOT in the GH #28 allowlist:\n  ${offenders.join(
        "\n  ",
      )}\nEither rename to kebab-case or add to KEBAB_CASE_EXCEPTIONS with a pointer to the tracking issue.`,
    ).toHaveLength(0)
  })

  // Soft assertion: mark the exceptions in GH #28 as todo so the tracking
  // issue stays visible in test output without turning the run red. When
  // #28 lands these get dropped from the allowlist and the hard test
  // above starts enforcing kebab-case universally.
  it.todo("GH #28: drop KEBAB_CASE_EXCEPTIONS allowlist once 5 underscore slugs are renamed")

  it("every catalog slug is unique", () => {
    const slugs = ALL_TOOLS.map((t) => t.slug)
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
    expect(dupes, `Duplicate catalog slugs: ${dupes.join(", ")}`).toHaveLength(0)
  })

  it("every seed compatibleTools entry either resolves in catalog or is a known orphan (GH #28)", () => {
    const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
    const unknown: Array<{ skillSlug: string; toolSlug: string }> = []

    for (const skill of TOOL_SPECIFIC_SKILLS) {
      for (const toolSlug of skill.compatibleTools) {
        if (catalogSlugs.has(toolSlug)) continue
        if (KNOWN_ORPHAN_COMPATIBLE_TOOLS.has(toolSlug)) continue
        unknown.push({ skillSlug: skill.slug, toolSlug })
      }
    }

    expect(
      unknown,
      `Seed compatibleTools reference unknown slugs (not in catalog, not in known-orphan allowlist):\n${unknown
        .map((u) => `  ${u.skillSlug} -> ${u.toolSlug}`)
        .join("\n")}`,
    ).toHaveLength(0)
  })

  it("all 4 canonical forms are reachable from the seed\u2192catalog join", () => {
    // Regression test for the original bug: a skill whose compatibleTools
    // contained a kebab-case form (e.g. twitter-api) would not match the
    // underscore-form catalog slug. After this PR the forms agree, so
    // every canonical form referenced by at least one seed must resolve.
    const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
    for (const canonical of CANONICAL_FORMS) {
      const referencedInSeeds = TOOL_SPECIFIC_SKILLS.some((skill) =>
        skill.compatibleTools.includes(canonical),
      )
      expect(
        referencedInSeeds,
        `Canonical slug '${canonical}' is not referenced by any seed skill's compatibleTools. Either the rename target is wrong or the seed is missing the link.`,
      ).toBe(true)
      expect(catalogSlugs.has(canonical)).toBe(true)
    }
  })
})

describe("rename-drifted-slugs data migration (GH #27)", () => {
  // Mirror of the rename map in prisma/migrations/rename-drifted-slugs.ts.
  // Kept in sync by convention — if you add a rename there, add it here
  // and the idempotency test below keeps both honest.
  const RENAMES: Array<[string, string]> = [
    ["twitter_api", "twitter-api"],
    ["youtube_data", "youtube-data-api"],
    ["gsc", "google-search-console"],
    ["google_analytics", "google-analytics"],
  ]

  // Apply the rename map to a list of slugs. Models what the data migration
  // script does to a column: rows whose value matches a `from` get their
  // value replaced with the corresponding `to`; everything else is
  // untouched.
  function applyRenames(rows: string[]): string[] {
    const map = new Map(RENAMES)
    return rows.map((r) => map.get(r) ?? r)
  }

  it("is idempotent \u2014 second application changes nothing", () => {
    const initial = [
      "twitter_api",
      "youtube_data",
      "gsc",
      "google_analytics",
      "sendgrid",
      "tavily",
      "googledrive",
      "unknown-future-slug",
    ]
    const once = applyRenames(initial)
    const twice = applyRenames(once)
    expect(twice).toEqual(once)
  })

  it("rewrites all 4 drift forms to their canonical form", () => {
    const applied = applyRenames(["twitter_api", "youtube_data", "gsc", "google_analytics"])
    expect(applied).toEqual([
      "twitter-api",
      "youtube-data-api",
      "google-search-console",
      "google-analytics",
    ])
  })

  it("does not touch non-drift slugs", () => {
    const untouched = [
      "sendgrid",
      "tavily",
      "stripe_api",
      "anthropic_api",
      "googledrive",
      "serp_api",
    ]
    expect(applyRenames(untouched)).toEqual(untouched)
  })

  it("rename map targets match catalog slugs exactly", () => {
    const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
    for (const [from, to] of RENAMES) {
      expect(
        catalogSlugs.has(to),
        `Rename target '${to}' (from '${from}') is not a current catalog slug. Did the catalog rename land out of sync with the migration?`,
      ).toBe(true)
      expect(
        catalogSlugs.has(from),
        `Rename source '${from}' still exists in catalog. The catalog rename should have replaced it with '${to}'.`,
      ).toBe(false)
    }
  })
})
