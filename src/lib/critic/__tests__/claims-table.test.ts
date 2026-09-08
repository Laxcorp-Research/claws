import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  STRICT_8_DEFINITION,
  VERSION_A_CLAIMS_TABLE,
  VERSION_A_DRAFT,
  VERSION_B_CLAIMS_TABLE,
  VERSION_B_DRAFT,
  VERSION_B_FIRST_PERSON_FIXTURE,
  THIRD_PARTY_ABOUT_USER_FIXTURE,
  hasFourDimensionScoreTable,
  isBareMeanVerdict,
  reviewDraft,
  runWave0ClaimsHarness,
  strict8Passes,
} from "@/lib/critic/claims-table"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"

function criticSoul(): string {
  const t = ALL_TEMPLATES.find((x) => x.slug === "twitter-growth-machine")
  if (!t) throw new Error("twitter-growth-machine missing")
  const a = t.agents.find((x) => x.agentSlug === "social-content-reviewer")
  if (!a) throw new Error("social-content-reviewer missing")
  return a.soulMd
}

describe("claims table procedure", () => {
  it("Version A PASSes and Version B REJECTs; quotes both claims tables", () => {
    const { a, b } = runWave0ClaimsHarness()
    expect(a.verdict).toBe("PASS")
    expect(a.reasons).toEqual([])
    expect(a.claimsTable).toBe(VERSION_A_CLAIMS_TABLE)
    expect(b.verdict).toBe("REJECT")
    expect(b.reasons.some((r) => r.includes("no source"))).toBe(true)
    expect(b.reasons.some((r) => r.includes("made-up.example"))).toBe(true)
    expect(VERSION_B_DRAFT).toContain(VERSION_B_FIRST_PERSON_FIXTURE)
    expect(VERSION_A_DRAFT).not.toContain(VERSION_B_FIRST_PERSON_FIXTURE)

    // Quoted tables (harness output the founder asked to see)
    expect(VERSION_A_CLAIMS_TABLE).toContain("| Claim | Source |")
    expect(VERSION_A_CLAIMS_TABLE).toContain("tool:tavily:r1")
    expect(VERSION_A_CLAIMS_TABLE).toContain("USER.md:12")
    expect(VERSION_B_CLAIMS_TABLE).toContain(VERSION_B_FIRST_PERSON_FIXTURE)
    expect(VERSION_B_CLAIMS_TABLE).toMatch(/\|\s*We hit this in Claws with a 4-minute scrape\s*\|\s*\|/)
  })

  it("MUTATION: table step removed → fails", () => {
    const missing = reviewDraft({
      draft: VERSION_A_DRAFT,
      claimsTable: null,
      knownSources: ["tool:tavily:r1", "USER.md:12"],
      toolResults: ["tool:tavily:r1 https://developer.apple.com/agent-seer"],
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    })
    expect(missing.verdict).toBe("REJECT")
    expect(missing.reasons.some((r) => r.includes(CLAIMS_TABLE_STEP_MARKER))).toBe(true)

    const src = readFileSync(join(process.cwd(), "src/lib/critic/claims-table.ts"), "utf8")
    expect(src).toContain("if (parsed === null)")
    expect(src).toContain("table step is required")
    expect(src).toContain(CLAIMS_TABLE_STEP_MARKER)

    const overlay = readFileSync(join(process.cwd(), "src/lib/openclaw/delivery-rail.ts"), "utf8")
    expect(overlay).toContain("CLAIMS_TABLE_STEP_MARKER")
    expect(overlay).toContain("opts?.critic")

    const wave0 = criticSoul()
    expect(wave0).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(wave0).toContain(VERSION_B_FIRST_PERSON_FIXTURE)
    expect(wave0).toContain(THIRD_PARTY_ABOUT_USER_FIXTURE)
  })

  it("rejects unsourced third-party-about-the-user claim (Hermes explicitly names Claws)", () => {
    const unsourced = reviewDraft({
      draft: `${THIRD_PARTY_ABOUT_USER_FIXTURE}.`,
      claimsTable: `| Claim | Source |\n| ${THIRD_PARTY_ABOUT_USER_FIXTURE} | |`,
      knownSources: ["USER.md:4"],
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    })
    expect(unsourced.verdict).toBe("REJECT")
    expect(unsourced.reasons.some((r) => r.includes("no source"))).toBe(true)
    expect(unsourced.reasons.some((r) => r.includes(THIRD_PARTY_ABOUT_USER_FIXTURE))).toBe(true)

    const sourced = reviewDraft({
      draft: `${THIRD_PARTY_ABOUT_USER_FIXTURE}.`,
      claimsTable: `| Claim | Source |\n| ${THIRD_PARTY_ABOUT_USER_FIXTURE} | USER.md:4 |`,
      knownSources: ["USER.md:4"],
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    })
    expect(sourced.verdict).toBe("PASS")
    expect(sourced.reasons).toEqual([])

    const src = readFileSync(join(process.cwd(), "src/lib/critic/claims-table.ts"), "utf8")
    expect(src).toContain("extractThirdPartyAboutUserClaims")
    expect(src).toContain("third-party-about-user claim has no source")
  })

  it("defines Strict-8 and tests the knob-2 floor", () => {
    expect(STRICT_8_DEFINITION).toMatch(/overall.*knob/i)
    expect(STRICT_8_DEFINITION).toMatch(/knob minus 2/)
    expect(STRICT_8_DEFINITION).toMatch(/PASS or REJECT only/)
    expect(STRICT_8_DEFINITION).toMatch(/no pass-with-warning/)

    expect(strict8Passes([8, 8, 8, 8], 8)).toBe(true)
    expect(strict8Passes([8, 8, 8, 7], 8)).toBe(false)
    expect(strict8Passes([9, 9, 9, 5], 8)).toBe(false)
    expect(strict8Passes([10, 8, 8, 6], 8)).toBe(true)
    expect(strict8Passes([10, 10, 10, 6], 8)).toBe(true)
    expect(strict8Passes([], 8)).toBe(false)

    const lowDim = reviewDraft({
      draft: VERSION_A_DRAFT,
      claimsTable: VERSION_A_CLAIMS_TABLE,
      knownSources: ["tool:tavily:r1", "USER.md:12"],
      toolResults: ["tool:tavily:r1 https://developer.apple.com/agent-seer"],
      knob: 8,
      dimensionScores: [9, 9, 9, 5],
    })
    expect(lowDim.verdict).toBe("REJECT")
    expect(lowDim.reasons.some((r) => r.includes("Strict-8"))).toBe(true)
  })

  it("gates URLs on tool-result provenance", () => {
    const orphan = reviewDraft({
      draft: "A sourced line. See https://orphan.example/x",
      claimsTable: "| Claim | Source |\n| A sourced line | USER.md:1 |",
      knownSources: ["USER.md:1"],
      toolResults: ["tool:tavily:r1 no matching url"],
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    })
    expect(orphan.verdict).toBe("REJECT")
    expect(orphan.reasons.some((r) => r.includes("[link]"))).toBe(true)

    const placeholder = reviewDraft({
      draft: "A sourced line. See [link] (verify).",
      claimsTable: "| Claim | Source |\n| A sourced line | USER.md:1 |",
      knownSources: ["USER.md:1"],
      toolResults: [],
      knob: 8,
      dimensionScores: [8, 8, 8, 8],
    })
    expect(placeholder.verdict).toBe("PASS")
  })

  it("verdict vocabulary is PASS/REJECT only across critic seed + overlay + factory", () => {
    const files = [
      "src/lib/critic/claims-table.ts",
      "src/lib/openclaw/delivery-rail.ts",
      "src/lib/openclaw/generator.ts",
      "prisma/seed-data/wave-0-twitter.ts",
      "prisma/seed-data/soul-generators.ts",
    ]
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      expect(src, rel).not.toMatch(/present best-with-warning/)
      expect(src, rel).not.toMatch(/present best attempt with (a )?quality warning/)
      expect(src, rel).not.toMatch(/recommend presenting with caveats/)
    }
    const wave0 = criticSoul()
    expect(wave0).toMatch(/\bPASS\b/)
    expect(wave0).toMatch(/\bREJECT\b/)
    expect(wave0).not.toMatch(/APPROVE\.|Verdict: \[APPROVED/)
  })

  it("rejects a bare mean and requires the four-dimension table", () => {
    const bare = "Critic Verdict: PASS (8.0/10 mean)"
    expect(isBareMeanVerdict(bare)).toBe(true)
    expect(hasFourDimensionScoreTable(bare)).toBe(false)
    const table = `${CRITIC_DIMENSION_TABLE_HEADER}
| fit | 8 | restates the scar |
| pricing | 8 | floor-safe |
| specificity | 8 | named steps |
| tone | 8 | operator |
Verdict: PASS`
    expect(hasFourDimensionScoreTable(table)).toBe(true)
    expect(isBareMeanVerdict(`${bare}\n${table}`)).toBe(false)
    const freelancer = ALL_TEMPLATES.find((x) => x.slug === "freelancer-revenue-engine")!
    const critic = freelancer.agents.find((a) => a.agentSlug === "business-development-reviewer")!
    expect(critic.soulMd).toContain(CRITIC_DIMENSION_TABLE_HEADER)
    expect(critic.soulMd).toContain("Never a bare mean")
    const quantTable = `${CRITIC_DIMENSION_TABLE_HEADER}
| thesis-quality | 8 | stop present |
| risk-adherence | 8 | under cap |
| evidence | 8 | tavily id |
| regime-fit | 8 | in-universe |
Verdict: PASS`
    expect(hasFourDimensionScoreTable(quantTable)).toBe(true)
    expect(isBareMeanVerdict(`${bare}\n${quantTable}`)).toBe(false)
    const youtubeTable = `${CRITIC_DIMENSION_TABLE_HEADER}
| hook | 8 | 0-8s names the cost |
| retention-logic | 8 | pattern interrupt |
| originality | 8 | not a clone |
| policy | 9 | no medical claim |
Verdict: PASS`
    expect(hasFourDimensionScoreTable(youtubeTable)).toBe(true)
  })
})
