import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  B2B_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-3-b2b"
import {
  AGENCY_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-3-agency"
import {
  COS_CRITIC_KNOB,
  COS_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-3-cos"
import {
  SEO_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-3-seo"
import {
  B2B_CRITIC_SCORE_DIMENSIONS,
  AGENCY_CRITIC_SCORE_DIMENSIONS,
  COS_CRITIC_SCORE_DIMENSIONS,
  SEO_CRITIC_SCORE_DIMENSIONS,
  CLAIMS_TABLE_STEP_MARKER,
  STRICT_8_DEFINITION,
} from "@/lib/critic/claims-table"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"
import { ALL_TOOLS } from "@/data/tool-catalog"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function template(slug: string) {
  const t = ALL_TEMPLATES.find((x) => x.slug === slug)
  if (!t) throw new Error(`${slug} missing`)
  return t
}

function agent(slug: string, agentSlug: string) {
  const a = template(slug).agents.find((x) => x.agentSlug === agentSlug)
  if (!a) throw new Error(agentSlug)
  return a
}

function expectNamedFiles(slug: string, paths: string[]) {
  const files = template(slug).files ?? []
  for (const name of paths) {
    const file = files.find((f) => f.path === name)
    expect(file, name).toBeDefined()
    expect(file!.content.length).toBeLessThan(8000)
    expect(file!.content).toContain("## Schema")
    expect(file!.content).toContain("## Format")
    expect(file!.content).toContain("## Example")
    expect(file!.content).toContain("## Entries")
  }
}

describe("WAVE-3 B2B Sales Machine", () => {
  const slug = "b2b-sales-machine"

  it("ICP framework, 5-email anatomy, 7-class replies, CAN-SPAM, critic dims", () => {
    expect(agent(slug, "sales-commander").soulMd).toContain("You are Sales Commander")
    expect(agent(slug, "icp-researcher").soulMd).toContain("ICP definition framework")
    expect(agent(slug, "icp-researcher").soulMd).toContain("Worked example")
    const seq = agent(slug, "sequence-writer").soulMd
    expect(seq).toContain("pattern-interrupt")
    expect(seq).toContain("social-proof")
    expect(seq).toContain("breakup")
    expect(seq).toContain("GOOD:")
    expect(seq).toContain("BAD:")
    expect(seq).toContain("CAN-SPAM")
    expect(agent(slug, "reply-handler").soulMd).toContain("7-class reply classifier")
    expect(agent(slug, "reply-handler").soulMd).toContain("unsubscribe")
    const critic = agent(slug, "outbound-quality-gate").soulMd
    for (const dim of B2B_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(critic).toContain(STRICT_8_DEFINITION)
    expect(critic).toContain("neverApprove")
    expect(agent(slug, "sales-commander").heartbeatMd).toContain("campaign/create")
    expect(agent(slug, "sequence-writer").skills).toContain("can-spam")
  })

  it("named files and five windows", () => {
    expectNamedFiles(slug, [
      "shared/ICP.md",
      "shared/SEQUENCES.md",
      "shared/PIPELINE.md",
      "shared/deliverables/sequence-draft.md",
    ])
    const scripts = parseHeartbeatWindowScripts(agent(slug, "sales-commander").heartbeatMd)
    expect(scripts).toHaveLength(5)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 8 * * 1-5",
      "30 8 * * 1-5",
      "0 10 * * 1-5",
      "0 14 * * 1-5",
      "0 16 * * 1-5",
    ])
  })

  it("same-session mini-mission is the sequence + critic", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(B2B_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-3 Agency Operations OS", () => {
  const slug = "agency-operations-os"
  const workers = [
    "intake-scoping-agent",
    "resource-allocator",
    "client-reporter",
    "task-manager",
    "finance-tracker",
  ] as const

  it("SOW, utilization 75-85%, change-order ACTION, neverDo on all 5 workers, critic neverApprove", () => {
    expect(agent(slug, "intake-scoping-agent").soulMd).toContain("SOW format")
    expect(agent(slug, "resource-allocator").soulMd).toContain("75-85%")
    expect(agent(slug, "finance-tracker").soulMd).toContain("Cash-flow forecast format")
    expect(agent(slug, "agency-commander").soulMd).toContain("change order")
    expect(agent(slug, "agency-commander").heartbeatMd).toContain("Gmail ACTION")
    for (const w of workers) {
      expect(agent(slug, w).soulMd, w).toMatch(/# Never/)
    }
    const critic = agent(slug, "agency-quality-gate").soulMd
    for (const dim of AGENCY_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
    expect(critic).toContain("internal margin")
  })

  it("named files CLIENTS / CAPACITY / SOW", () => {
    expectNamedFiles(slug, ["shared/CLIENTS.md", "shared/CAPACITY.md", "shared/SOW.md"])
    expect(parseHeartbeatWindowScripts(agent(slug, "agency-commander").heartbeatMd).length).toBe(5)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(AGENCY_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-3 Founder's Chief of Staff", () => {
  const slug = "founders-chief-of-staff"

  it("06:30 briefing, meeting-prep, bi-directional commitments, critic 8.5", () => {
    expect(agent(slug, "briefing-compiler").soulMd).toContain("06:30 briefing format")
    expect(agent(slug, "briefing-compiler").soulMd).toContain("Worked example")
    expect(agent(slug, "meeting-prep-agent").soulMd).toContain("Meeting-prep brief format")
    expect(agent(slug, "action-tracker").soulMd).toContain("Bi-directional commitment tracking")
    expect(agent(slug, "communication-drafter").soulMd).toContain("ACTION card")
    expect(agent(slug, "executive-quality-gate").qualityThreshold).toBe(COS_CRITIC_KNOB)
    expect(agent(slug, "executive-quality-gate").soulMd).toContain(String(COS_CRITIC_KNOB))
    expect(agent(slug, "executive-quality-gate").agentsMd).toContain(String(COS_CRITIC_KNOB))
    const critic = agent(slug, "executive-quality-gate").soulMd
    for (const dim of COS_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files BRIEFING / ACTION_LOG / COMMITMENTS", () => {
    expectNamedFiles(slug, [
      "shared/BRIEFING.md",
      "shared/ACTION_LOG.md",
      "shared/COMMITMENTS.md",
      "shared/deliverables/morning-briefing.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "chief-of-staff").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(COS_FIRST_MISSION_PROSE)
    expect(pending).toContain("8.5")
  })
})

describe("WAVE-3 SEO Empire Builder", () => {
  const slug = "seo-empire-builder"

  it("clustering, E-E-A-T, YMYL, audits, neverApprove, honest GSC", () => {
    expect(agent(slug, "keyword-strategist").soulMd).toContain("Keyword clustering")
    expect(agent(slug, "keyword-strategist").soulMd).toContain("worked example")
    expect(agent(slug, "content-writer").soulMd).toContain("E-E-A-T content brief format")
    expect(agent(slug, "content-writer").soulMd).toContain("YMYL flag rule")
    expect(agent(slug, "technical-seo-monitor").soulMd).toContain("Technical-SEO audit format")
    expect(agent(slug, "rank-tracker").soulMd).toContain("Rank report format")
    const critic = agent(slug, "seo-quality-gate").soulMd
    for (const dim of SEO_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
    expect(critic).toContain("YMYL")
    const gsc = ALL_SKILLS.find((s) => s.slug === "google-search-console")
    expect(gsc?.description).not.toMatch(/via Composio/i)
    expect(gsc?.skillMd).toContain("This is not a Composio skill")
    const catalog = ALL_TOOLS.find((t) => t.slug === "google-search-console")
    expect(catalog?.connectionType).toBe("API_KEY")
    const tmpl = template(slug).tools.find((t) => t.slug === "google-search-console")
    expect(tmpl?.connectionType).toBe("API_KEY")
    const allow = readFileSync(
      join(process.cwd(), "src/data/__fixtures__/composio-toolkit-allowlist.txt"),
      "utf8",
    )
    expect(allow).not.toMatch(/searchconsole/i)
    expect(agent(slug, "seo-commander").soulMd).toContain("no googlesearchconsole")
  })

  it("named files KEYWORDS / CONTENT_CAL / BACKLINKS", () => {
    expectNamedFiles(slug, [
      "shared/KEYWORDS.md",
      "shared/CONTENT_CAL.md",
      "shared/BACKLINKS.md",
      "shared/deliverables/content-brief.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "seo-commander").heartbeatMd).length).toBe(5)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(SEO_FIRST_MISSION_PROSE)
  })
})
