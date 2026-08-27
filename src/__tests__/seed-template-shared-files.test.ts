import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES, TEMPLATE_NAMED_FILES } from "../../prisma/seed-data"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"
import { isSafeSeedRelativePath } from "@/lib/workspace-seed-files"
import { toAgentId } from "@/lib/openclaw/generator"
import { expandSeedFilesForAgents } from "@/lib/workspace-seed-files"

const EXPECTED_NAMED: Record<string, string[]> = {
  "quant-trader": ["PORTFOLIO.md"],
  "freelancer-revenue-engine": [],
  "ecommerce-profit-maximizer": [],
  "youtube-channel-os": ["VOICE.md"],
  "twitter-growth-machine": ["VOICE.md"],
  "newsletter-empire": ["VOICE.md"],
  "podcast-production-studio": ["GUEST_PIPELINE.md"],
  "b2b-sales-machine": ["ICP.md", "SEQUENCE.md"],
  "agency-operations-os": ["CAPACITY.md"],
  "founders-chief-of-staff": ["ACTION_LOG.md"],
  "seo-empire-builder": ["CONTENT_CAL.md"],
  "real-estate-agent-os": ["MARKET.md", "LISTINGS.md"],
  "recruiter-os": [],
  "medical-practice-manager": [],
  "law-firm-intake-os": [],
  "home-services-dispatcher": [],
  "health-fitness-commander": ["PROGRAM.md", "LOG.md"],
  "student-accelerator": [],
  "job-hunter-os": [],
  "developer-productivity-os": [],
}

const PROSE_BINDS: Array<{ slug: string; agentSlug: string; needle: string }> = [
  { slug: "quant-trader", agentSlug: "portfolio-tracker", needle: "PORTFOLIO.md" },
  { slug: "twitter-growth-machine", agentSlug: "content-writer", needle: "VOICE.md" },
  { slug: "youtube-channel-os", agentSlug: "script-builder", needle: "VOICE.md" },
  { slug: "newsletter-empire", agentSlug: "draft-writer", needle: "VOICE.md" },
  { slug: "podcast-production-studio", agentSlug: "guest-researcher-booker", needle: "GUEST_PIPELINE.md" },
  { slug: "b2b-sales-machine", agentSlug: "icp-researcher", needle: "ICP.md" },
  { slug: "b2b-sales-machine", agentSlug: "sequence-writer", needle: "SEQUENCE.md" },
  { slug: "agency-operations-os", agentSlug: "resource-allocator", needle: "CAPACITY.md" },
  { slug: "founders-chief-of-staff", agentSlug: "action-tracker", needle: "ACTION_LOG.md" },
  { slug: "seo-empire-builder", agentSlug: "keyword-strategist", needle: "CONTENT_CAL.md" },
  { slug: "real-estate-agent-os", agentSlug: "market-intel-agent", needle: "MARKET.md" },
  { slug: "real-estate-agent-os", agentSlug: "client-communicator", needle: "LISTINGS.md" },
  { slug: "health-fitness-commander", agentSlug: "workout-planner", needle: "PROGRAM.md" },
  { slug: "health-fitness-commander", agentSlug: "habit-recovery-tracker", needle: "LOG.md" },
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
      const named = files.filter((f) => f.path !== "memory/MEMORY.md").map((f) => f.path).sort()
      expect(named, template.slug).toEqual([...(EXPECTED_NAMED[template.slug] ?? [])].sort())
      total += files.length
      for (const file of files) {
        expect(isSafeSeedRelativePath(file.path), file.path).toBe(true)
        expect(file.content).toContain("Maintained by")
        expect(file.content).toContain("## Schema")
        expect(file.content).toContain("## Entries")
      }
    }
    expect(total).toBe(34)
  })

  it("seed snapshot builder emits files[] (MUTATION: drop files pass-through → fail)", () => {
    const twitter = ALL_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")!
    const snap = JSON.parse(buildWorkspaceSnapshotFromSeedTemplate(twitter)) as {
      files?: Array<{ path: string; content: string }>
    }
    expect(snap.files?.map((f) => f.path).sort()).toEqual(["VOICE.md", "memory/MEMORY.md"])
  })

  it("prose execution steps name-match the seeded files", () => {
    for (const bind of PROSE_BINDS) {
      const template = ALL_TEMPLATES.find((t) => t.slug === bind.slug)!
      const agent = template.agents.find((a) => a.agentSlug === bind.agentSlug)
      expect(agent, `${bind.slug}/${bind.agentSlug}`).toBeTruthy()
      expect(agent!.agentsMd, `${bind.slug}/${bind.agentSlug}`).toContain(bind.needle)
    }
  })

  it("Twitter/X generated file tree fans MEMORY.md + VOICE.md into every agent workspace", () => {
    const twitter = ALL_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")!
    const dirs = twitter.agents.map((a) => `workspace-${toAgentId(a.name)}`)
    const tree = expandSeedFilesForAgents(twitter.files ?? [], dirs)
    const keys = Object.keys(tree).sort()
    expect(dirs.length).toBe(6)
    expect(keys).toHaveLength(12)
    for (const dir of dirs) {
      expect(keys).toContain(`${dir}/memory/MEMORY.md`)
      expect(keys).toContain(`${dir}/VOICE.md`)
      expect(tree[`${dir}/VOICE.md`]).toContain("Maintained by content-writer")
    }
  })
})
