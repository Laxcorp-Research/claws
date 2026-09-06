import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  FREELANCER_FIRST_MISSION_PROSE,
  INVOICE_ESCALATION_LADDER,
  INVENTED_CLIENT_RESULT_FIXTURE,
} from "../../prisma/seed-data/wave-1-freelancer"
import {
  CLAIMS_TABLE_STEP_MARKER,
  STRICT_8_DEFINITION,
  VERSION_B_FIRST_PERSON_FIXTURE,
} from "@/lib/critic/claims-table"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"

function freelancer() {
  const t = ALL_TEMPLATES.find((x) => x.slug === "freelancer-revenue-engine")
  if (!t) throw new Error("freelancer-revenue-engine missing")
  return t
}

function agent(slug: string) {
  const a = freelancer().agents.find((x) => x.agentSlug === slug)
  if (!a) throw new Error(slug)
  return a
}

describe("WAVE-1 Freelancer Revenue Engine prose contracts", () => {
  it("Lead Hunter has 100-point scoring, a worked scored example, and a red-flag list", () => {
    const soul = agent("lead-hunter").soulMd
    expect(soul).toContain("100-point opportunity scoring")
    expect(soul).toContain("Niche fit")
    expect(soul).toContain("0-25")
    expect(soul).toContain("Worked scored example")
    expect(soul).toContain("Total 93")
    expect(soul).toContain("Red-flag list")
    expect(soul).toContain("Equity")
    expect(soul).toContain("Send samples")
    expect(soul).toContain("empty-credential stub")
  })

  it("Proposal Writer has anatomy, GOOD vs BAD pair, pricing logic, and grounding law", () => {
    const soul = agent("proposal-writer").soulMd
    expect(soul).toContain("Proposal anatomy")
    expect(soul).toContain("GOOD vs BAD")
    expect(soul).toContain("WHY:")
    expect(soul).toContain("Pricing logic")
    expect(soul).toContain("Grounding law")
    expect(soul).toContain("NEVER invent past clients")
    expect(soul).toContain("[YOUR NUMBER]")
    expect(soul).toContain("[YOUR CLIENT]")
    expect(soul).toContain(INVENTED_CLIENT_RESULT_FIXTURE)
    expect(agent("proposal-writer").agentsMd).toContain("[YOUR NUMBER]")
  })

  it("critic + writer catch invented past clients/results (MUTATION: number-only anchor → fail)", () => {
    const writer = agent("proposal-writer").soulMd
    const critic = agent("business-development-reviewer").soulMd
    expect(INVENTED_CLIENT_RESULT_FIXTURE).toContain("Acme")
    expect(writer).toContain(INVENTED_CLIENT_RESULT_FIXTURE)
    expect(critic).toContain(INVENTED_CLIENT_RESULT_FIXTURE)
    expect(writer).toContain("NEVER invent past clients")
    expect(critic).toContain("Invented past client or result")
  })

  it("Project Manager has a scope-creep tree and check-in cadence", () => {
    const soul = agent("project-manager").soulMd
    expect(soul).toContain("Scope-creep decision tree")
    expect(soul).toContain("signed scope")
    expect(soul).toContain("change order")
    expect(soul).toContain("Check-in cadence")
    expect(soul).toContain("daily async")
    expect(soul).toContain("twice a week")
  })

  it("Invoice & Collections embeds the Day-0 to +30 ladder verbatim", () => {
    const soul = agent("invoice-collections").soulMd
    expect(soul).toContain(INVOICE_ESCALATION_LADDER)
    expect(INVOICE_ESCALATION_LADDER).toContain("Day 0 (send day)")
    expect(INVOICE_ESCALATION_LADDER).toContain("Day +3:")
    expect(INVOICE_ESCALATION_LADDER).toContain("Day +7:")
    expect(INVOICE_ESCALATION_LADDER).toContain("Day +14:")
    expect(INVOICE_ESCALATION_LADDER).toContain("Day +21:")
    expect(INVOICE_ESCALATION_LADDER).toContain("Day +30:")
    expect(soul).toContain("Never threaten legal action")
  })

  it("Commander pauses prospecting above 80% and runs the same-session mini-mission", () => {
    const soul = agent("revenue-commander").soulMd
    expect(soul).toContain("above 80%")
    expect(soul).toContain("pause prospecting")
    expect(soul).toContain("mini first-mission")
    expect(soul).toContain("one 100-point scored lead")
    expect(soul).toContain("one proposal draft")
    expect(soul).toContain("Critic approval is not human approval")
    expect(soul).toContain("empty-credential stub")
    expect(soul).toContain("drafted, awaiting your approval to send")
    expect(soul).toContain("| Dimension | Score | Anchor |")
    expect(soul).toContain("Never a bare mean")
    expect(agent("revenue-commander").heartbeatMd).toContain("Never a /home/node/.openclaw/ path")
  })

  it("Business Development Reviewer names fit/pricing/specificity/tone, claims table, PASS/REJECT only", () => {
    const soul = agent("business-development-reviewer").soulMd
    expect(soul).toContain("fit")
    expect(soul).toContain("pricing")
    expect(soul).toContain("specificity")
    expect(soul).toContain("tone")
    expect(soul).toContain("ONE thing to fix")
    expect(soul).toContain("Rewritten example line")
    expect(soul).toContain("Score format (mandatory on PASS and REJECT)")
    expect(soul).toContain("| Dimension | Score | Anchor |")
    expect(soul).toContain("Never a bare mean")
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain("| Claim | Source |")
    expect(soul).toContain(VERSION_B_FIRST_PERSON_FIXTURE)
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).toMatch(/\bPASS\b/)
    expect(soul).toMatch(/\bREJECT\b/)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    const files = freelancer().files ?? []
    for (const name of [
      "shared/PIPELINE.md",
      "shared/CLIENTS.md",
      "shared/PROPOSALS.md",
      "shared/deliverables/proposal-draft.md",
      "shared/deliverables/invoice-cycle.md",
      "shared/deliverables/weekly-pipeline.md",
    ]) {
      const file = files.find((f) => f.path === name)
      expect(file, name).toBeDefined()
      expect(file!.content.length).toBeLessThan(8000)
      expect(file!.content).toContain("## Schema")
      expect(file!.content).toContain("## Format")
      expect(file!.content).toContain("## Example")
      expect(file!.content).toContain("## Entries")
    }
  })

  it("four windows stay parseable with failure branches (MUTATION: drop DEGRADED → fail)", () => {
    const scripts = parseHeartbeatWindowScripts(agent("revenue-commander").heartbeatMd)
    expect(scripts).toHaveLength(4)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 9 * * 1-5",
      "0 10 * * 1-5",
      "0 13 * * 1-5",
      "0 17 * * 1-5",
    ])
    for (const script of scripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(3)
      expect(script.deliverable.length).toBeGreaterThan(0)
    }
    const md = agent("revenue-commander").heartbeatMd
    expect(md).toContain("DEGRADED")
    expect(md).toContain("tavily")
    expect(md).toContain("empty-credential stub")
    expect(md).toContain("prospecting paused >80%")
    expect(md).toContain("gmail missing")
  })

  it("tavily / gmail-ops / google-calendar SKILL.md carry freelancer craft; upwork stays a stub", () => {
    const tavily = ALL_SKILLS.find((s) => s.slug === "tavily-search")
    const gmail = ALL_SKILLS.find((s) => s.slug === "gmail-ops")
    const calendar = ALL_SKILLS.find((s) => s.slug === "google-calendar")
    const upwork = ALL_SKILLS.find((s) => s.slug === "upwork")
    expect(tavily?.skillMd).toContain("Freelancer lead-scan patterns")
    expect(tavily?.skillMd).toContain("never claim an Upwork search ran")
    expect(gmail?.skillMd).toContain("Never-send-without-approval")
    expect(gmail?.skillMd).toContain("Day-0 to +30")
    expect(calendar?.skillMd).toContain("[Claws] <client> check-in")
    expect(calendar?.skillMd).toContain("Never invite the client")
    expect(upwork).toBeUndefined()
  })

  it("post-interview mini-mission is one scored lead + one proposal in the same session", () => {
    const pack = getInterviewPack("freelancer-revenue-engine")!
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: "freelancer-revenue-engine",
    })
    expect(pending).toContain(FREELANCER_FIRST_MISSION_PROSE)
    expect(pending).toContain("One 100-point scored lead")
    expect(pending).toContain("one proposal draft")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8; factory philosophy stays gone", () => {
    expect(agent("business-development-reviewer").qualityThreshold).toBe(8)
    const commander = agent("revenue-commander").soulMd
    expect(commander).not.toContain("Revenue is the oxygen")
    expect(commander).not.toContain("Consistency compounds")
  })
})
