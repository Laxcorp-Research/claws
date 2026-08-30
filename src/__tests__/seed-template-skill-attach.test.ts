import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES, TEMPLATE_SKILL_ATTACH } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { TOOL_SPECIFIC_SKILLS } from "../../prisma/seed-data/skills-tool-specific"
import { normalizeSeedAgentSkills } from "@/lib/marketplace/workspace-snapshot"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CATALOG = new Set(ALL_SKILLS.map((s) => s.slug))

const DOMAIN_ON_EVERY_AGENT: Record<string, string[]> = {
  "medical-practice-manager": ["hipaa-compliance"],
  "real-estate-agent-os": ["fair-housing"],
  "law-firm-intake-os": ["legal-communication", "emergency-triage"],
  "home-services-dispatcher": ["emergency-triage"],
  "student-accelerator": ["academic-integrity"],
}

describe("INFRA-3 seed template skill attach", () => {
  it("covers all 20 templates and every seed agent slug", () => {
    expect(Object.keys(TEMPLATE_SKILL_ATTACH).sort()).toEqual(
      ALL_TEMPLATES.map((t) => t.slug).sort(),
    )
    for (const template of ALL_TEMPLATES) {
      const map = TEMPLATE_SKILL_ATTACH[template.slug]
      expect(Object.keys(map!).sort()).toEqual(
        template.agents.map((a) => a.agentSlug).sort(),
      )
    }
  })

  it("every attached slug is in the 54-skill catalog", () => {
    const unknown: Array<{ template: string; agent: string; slug: string }> = []
    for (const template of ALL_TEMPLATES) {
      for (const agent of template.agents) {
        for (const slug of agent.skills) {
          if (!CATALOG.has(slug)) {
            unknown.push({ template: template.slug, agent: agent.agentSlug, slug })
          }
        }
      }
    }
    expect(unknown, JSON.stringify(unknown)).toEqual([])
  })

  it("every template attaches at least one catalog skill (MUTATION: skills:[] restored → fail)", () => {
    const empty = ALL_TEMPLATES.filter((t) => t.agents.every((a) => a.skills.length === 0))
    expect(
      empty.map((t) => t.slug),
      "templates with all agents skills:[]",
    ).toEqual([])
  })

  it("domain packs land on every agent of their vertical", () => {
    for (const [slug, packs] of Object.entries(DOMAIN_ON_EVERY_AGENT)) {
      const template = ALL_TEMPLATES.find((t) => t.slug === slug)
      expect(template, slug).toBeTruthy()
      for (const agent of template!.agents) {
        for (const pack of packs) {
          expect(
            agent.skills,
            `${slug}/${agent.agentSlug} missing ${pack}`,
          ).toContain(pack)
        }
      }
    }
  })

  it("B2B can-spam sits on orch + sequence + reply + critic", () => {
    const template = ALL_TEMPLATES.find((t) => t.slug === "b2b-sales-machine")!
    const must = [
      "sales-commander",
      "sequence-writer",
      "reply-handler",
      "outbound-quality-gate",
    ]
    for (const agentSlug of must) {
      const agent = template.agents.find((a) => a.agentSlug === agentSlug)
      expect(agent?.skills, agentSlug).toContain("can-spam")
    }
  })

  it("agnostic packs land only where they fit", () => {
    const job = ALL_TEMPLATES.find((t) => t.slug === "job-hunter-os")!
    expect(job.agents.find((a) => a.agentSlug === "interview-coach")!.skills).toContain(
      "interview-preparation",
    )
    expect(job.agents.find((a) => a.agentSlug === "negotiation-advisor")!.skills).toContain(
      "salary-negotiation",
    )
    const recruiter = ALL_TEMPLATES.find((t) => t.slug === "recruiter-os")!
    expect(
      recruiter.agents.flatMap((a) => a.skills),
    ).not.toContain("interview-preparation")
    const dev = ALL_TEMPLATES.find((t) => t.slug === "developer-productivity-os")!
    expect(dev.agents.find((a) => a.agentSlug === "pr-reviewer")!.skills).toContain(
      "code-review-framework",
    )
    expect(dev.agents.find((a) => a.agentSlug === "code-quality-gate")!.skills).toContain(
      "code-review-framework",
    )
  })

  it("youtube-data-api skill compatibleTools is the OAuth youtube slug (slug-drift kill)", () => {
    const skill = TOOL_SPECIFIC_SKILLS.find((s) => s.slug === "youtube-data-api")
    expect(skill?.compatibleTools).toEqual(["youtube"])
    expect(skill?.compatibleTools).not.toContain("youtube-data-api")
    expect(skill?.skillMd).toContain("YOUTUBE_SEARCH_YOU_TUBE")
    expect(skill?.skillMd).not.toContain("YOUTUBE_DATA_API_KEY")
  })

  it("Founders CoS critic seed stamps qualityThreshold 8.5", () => {
    const template = ALL_TEMPLATES.find((t) => t.slug === "founders-chief-of-staff")
    const critic = template!.agents.find((a) => a.agentSlug === "executive-quality-gate")
    expect(critic?.qualityThreshold).toBe(8.5)
  })

  it("snapshot normalize turns seed string[] into install-readable { slug } objects", () => {
    expect(normalizeSeedAgentSkills(["twitter-api", "tavily-search"])).toEqual([
      { slug: "twitter-api" },
      { slug: "tavily-search" },
    ])
    expect(normalizeSeedAgentSkills([{ skillSlug: "hipaa-compliance" }])).toEqual([
      { slug: "hipaa-compliance" },
    ])
  })

  it("MUTATION: snapshot builder must normalize seed skills before JSON", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/marketplace/workspace-snapshot.ts"),
      "utf8",
    )
    expect(src).toContain("normalizeSeedAgentSkills(a.skills)")
  })

  it("MUTATION: install slug reader must accept string entries", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/workspace-from-template.ts"),
      "utf8",
    )
    expect(src).toContain('typeof entry === "string"')
  })
})
