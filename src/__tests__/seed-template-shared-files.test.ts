import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES, TEMPLATE_NAMED_FILES } from "../../prisma/seed-data"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"
import { isSafeSeedRelativePath } from "@/lib/workspace-seed-files"
import { toAgentId } from "@/lib/openclaw/generator"
import { expandSeedFilesForAgents } from "@/lib/workspace-seed-files"

const SHARED = "/home/node/.openclaw/shared"

const EXPECTED_NAMED: Record<string, string[]> = {
  "quant-trader": ["shared/PORTFOLIO.md"],
  "freelancer-revenue-engine": [],
  "ecommerce-profit-maximizer": [],
  "youtube-channel-os": ["shared/VOICE.md"],
  "twitter-growth-machine": [
    "shared/VOICE.md",
    "shared/deliverables/x-morning-trends.md",
    "shared/deliverables/x-content-cycle.md",
    "shared/deliverables/x-daily-recap.md",
  ],
  "newsletter-empire": ["shared/VOICE.md"],
  "podcast-production-studio": ["shared/GUEST_PIPELINE.md"],
  "b2b-sales-machine": ["shared/ICP.md", "shared/SEQUENCE.md"],
  "agency-operations-os": ["shared/CAPACITY.md"],
  "founders-chief-of-staff": ["shared/ACTION_LOG.md"],
  "seo-empire-builder": ["shared/CONTENT_CAL.md"],
  "real-estate-agent-os": ["shared/MARKET.md", "shared/LISTINGS.md"],
  "recruiter-os": [],
  "medical-practice-manager": [],
  "law-firm-intake-os": [],
  "home-services-dispatcher": [],
  "health-fitness-commander": ["shared/PROGRAM.md", "shared/LOG.md"],
  "student-accelerator": [],
  "job-hunter-os": [],
  "developer-productivity-os": [],
}

const PROSE_BINDS: Array<{ slug: string; agentSlug: string; needle: string }> = [
  { slug: "quant-trader", agentSlug: "portfolio-tracker", needle: `${SHARED}/PORTFOLIO.md` },
  { slug: "twitter-growth-machine", agentSlug: "content-writer", needle: `${SHARED}/VOICE.md` },
  { slug: "youtube-channel-os", agentSlug: "script-builder", needle: `${SHARED}/VOICE.md` },
  { slug: "newsletter-empire", agentSlug: "draft-writer", needle: `${SHARED}/VOICE.md` },
  { slug: "podcast-production-studio", agentSlug: "guest-researcher-booker", needle: `${SHARED}/GUEST_PIPELINE.md` },
  { slug: "b2b-sales-machine", agentSlug: "icp-researcher", needle: `${SHARED}/ICP.md` },
  { slug: "b2b-sales-machine", agentSlug: "sequence-writer", needle: `${SHARED}/SEQUENCE.md` },
  { slug: "agency-operations-os", agentSlug: "resource-allocator", needle: `${SHARED}/CAPACITY.md` },
  { slug: "founders-chief-of-staff", agentSlug: "action-tracker", needle: `${SHARED}/ACTION_LOG.md` },
  { slug: "seo-empire-builder", agentSlug: "keyword-strategist", needle: `${SHARED}/CONTENT_CAL.md` },
  { slug: "real-estate-agent-os", agentSlug: "market-intel-agent", needle: `${SHARED}/MARKET.md` },
  { slug: "real-estate-agent-os", agentSlug: "client-communicator", needle: `${SHARED}/LISTINGS.md` },
  { slug: "health-fitness-commander", agentSlug: "workout-planner", needle: `${SHARED}/PROGRAM.md` },
  { slug: "health-fitness-commander", agentSlug: "habit-recovery-tracker", needle: `${SHARED}/LOG.md` },
]

describe("INFRA-2 seed shared-file manifests", () => {
  it("covers all 20 templates with memory/MEMORY.md plus Phase A named files", () => {
    expect(Object.keys(TEMPLATE_NAMED_FILES).sort()).toEqual(
      ALL_TEMPLATES.map((t) => t.slug).sort(),
    )
    expect(ALL_TEMPLATES).toHaveLength(20)

    let total = 0
    for (const template of ALL_TEMPLATES) {
      const files = template.files ?? []
      expect(files.some((f) => f.path === "memory/MEMORY.md"), template.slug).toBe(true)
      expect(files.some((f) => f.path === "shared/USER.md"), template.slug).toBe(true)
      const named = files
        .filter((f) => f.path !== "memory/MEMORY.md" && f.path !== "shared/USER.md")
        .map((f) => f.path)
        .sort()
      expect(named, template.slug).toEqual([...(EXPECTED_NAMED[template.slug] ?? [])].sort())
      total += files.length
      for (const file of files) {
        expect(isSafeSeedRelativePath(file.path), file.path).toBe(true)
        expect(file.content).toContain("Maintained by")
        expect(file.content).toContain("## Schema")
        expect(file.content).toContain("## Entries")
      }
    }
    expect(total).toBe(57)
  })

  it("seed snapshot builder emits files[] (MUTATION: drop files pass-through → fail)", () => {
    const twitter = ALL_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")!
    const snap = JSON.parse(buildWorkspaceSnapshotFromSeedTemplate(twitter)) as {
      files?: Array<{ path: string; content: string }>
    }
    expect(snap.files?.map((f) => f.path).sort()).toEqual([
      "memory/MEMORY.md",
      "shared/USER.md",
      "shared/VOICE.md",
      "shared/deliverables/x-content-cycle.md",
      "shared/deliverables/x-daily-recap.md",
      "shared/deliverables/x-morning-trends.md",
    ])
  })

  it("prose execution steps bind to the shared host path", () => {
    for (const bind of PROSE_BINDS) {
      const template = ALL_TEMPLATES.find((t) => t.slug === bind.slug)!
      const agent = template.agents.find((a) => a.agentSlug === bind.agentSlug)
      expect(agent, `${bind.slug}/${bind.agentSlug}`).toBeTruthy()
      expect(agent!.agentsMd, `${bind.slug}/${bind.agentSlug}`).toContain(bind.needle)
    }
  })

  it("Twitter/X generated tree: VOICE.md once at shared/; MEMORY.md per agent", () => {
    const twitter = ALL_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")!
    const dirs = twitter.agents.map((a) => `workspace-${toAgentId(a.name)}`)
    const tree = expandSeedFilesForAgents(twitter.files ?? [], dirs)
    const keys = Object.keys(tree).sort()
    expect(dirs.length).toBe(6)
    expect(keys).toHaveLength(11)
    expect(keys).toContain("shared/VOICE.md")
    expect(keys).toContain("shared/USER.md")
    expect(tree["shared/VOICE.md"]).toContain("Maintained by content-writer")
    expect(keys.filter((k) => k.endsWith("/VOICE.md") || k === "VOICE.md")).toEqual(["shared/VOICE.md"])
    for (const dir of dirs) {
      expect(keys).toContain(`${dir}/memory/MEMORY.md`)
      expect(keys).not.toContain(`${dir}/VOICE.md`)
    }
  })
})
