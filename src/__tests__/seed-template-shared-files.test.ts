import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES, TEMPLATE_NAMED_FILES } from "../../prisma/seed-data"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"
import { isSafeSeedRelativePath } from "@/lib/workspace-seed-files"
import { toAgentId } from "@/lib/openclaw/generator"
import { expandSeedFilesForAgents } from "@/lib/workspace-seed-files"

const SHARED = "/home/node/.openclaw/shared"

const EXPECTED_NAMED: Record<string, string[]> = {
  "quant-trader": [
    "shared/PORTFOLIO.md",
    "shared/WATCHLIST.md",
    "shared/THESES.md",
    "shared/deliverables/pre-market-scan.md",
    "shared/deliverables/trade-thesis.md",
    "shared/deliverables/trade-alert.md",
    "shared/deliverables/paper-ticket.md",
    "shared/deliverables/eod-risk-report.md",
  ],
  "freelancer-revenue-engine": [
    "shared/PIPELINE.md",
    "shared/CLIENTS.md",
    "shared/PROPOSALS.md",
    "shared/deliverables/proposal-draft.md",
    "shared/deliverables/invoice-cycle.md",
    "shared/deliverables/weekly-pipeline.md",
  ],
  "ecommerce-profit-maximizer": [
    "shared/SKUS.md",
    "shared/PRICING.md",
    "shared/ADS.md",
    "shared/deliverables/inventory-check.md",
    "shared/deliverables/pricing-recommendation.md",
    "shared/deliverables/listing-audit.md",
    "shared/deliverables/ad-review.md",
    "shared/deliverables/product-pnl.md",
  ],
  "youtube-channel-os": [
    "shared/VOICE.md",
    "shared/VIDEOS.md",
    "shared/IDEAS.md",
    "shared/CALENDAR.md",
    "shared/deliverables/trend-scan.md",
    "shared/deliverables/idea-slate.md",
    "shared/deliverables/scored-titles.md",
    "shared/deliverables/script-draft.md",
    "shared/deliverables/seo-metadata.md",
    "shared/deliverables/post-publish-6h.md",
  ],
  "twitter-growth-machine": [
    "shared/VOICE.md",
    "shared/deliverables/x-morning-trends.md",
    "shared/deliverables/x-content-cycle.md",
    "shared/deliverables/x-daily-recap.md",
  ],
  "newsletter-empire": [
    "shared/VOICE.md",
    "shared/ISSUES.md",
    "shared/SUBSCRIBERS.md",
    "shared/deliverables/research-slate.md",
    "shared/deliverables/issue-draft.md",
    "shared/deliverables/growth-note.md",
    "shared/deliverables/sponsor-pitch.md",
  ],
  "podcast-production-studio": [
    "shared/SHOW_BIBLE.md",
    "shared/GUEST_PIPELINE.md",
    "shared/deliverables/guest-board.md",
    "shared/deliverables/outreach-email.md",
    "shared/deliverables/guest-brief.md",
    "shared/deliverables/show-notes.md",
    "shared/deliverables/repurpose-plan.md",
  ],
  "b2b-sales-machine": [
    "shared/ICP.md",
    "shared/SEQUENCES.md",
    "shared/PIPELINE.md",
    "shared/deliverables/icp-refresh.md",
    "shared/deliverables/enrich-shortlist.md",
    "shared/deliverables/sequence-draft.md",
    "shared/deliverables/reply-triage.md",
    "shared/deliverables/pipeline-report.md",
  ],
  "agency-operations-os": [
    "shared/CLIENTS.md",
    "shared/CAPACITY.md",
    "shared/SOW.md",
    "shared/deliverables/capacity-brief.md",
    "shared/deliverables/change-order.md",
    "shared/deliverables/client-status.md",
    "shared/deliverables/cash-flow.md",
  ],
  "founders-chief-of-staff": [
    "shared/BRIEFING.md",
    "shared/ACTION_LOG.md",
    "shared/COMMITMENTS.md",
    "shared/deliverables/morning-briefing.md",
    "shared/deliverables/meeting-prep.md",
    "shared/deliverables/exec-comms.md",
  ],
  "seo-empire-builder": [
    "shared/KEYWORDS.md",
    "shared/CONTENT_CAL.md",
    "shared/BACKLINKS.md",
    "shared/deliverables/keyword-clusters.md",
    "shared/deliverables/content-brief.md",
    "shared/deliverables/tech-audit.md",
    "shared/deliverables/rank-report.md",
  ],
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
  { slug: "quant-trader", agentSlug: "market-scanner", needle: `${SHARED}/WATCHLIST.md` },
  { slug: "quant-trader", agentSlug: "signal-analyst", needle: `${SHARED}/THESES.md` },
  { slug: "freelancer-revenue-engine", agentSlug: "lead-hunter", needle: `${SHARED}/PIPELINE.md` },
  { slug: "freelancer-revenue-engine", agentSlug: "proposal-writer", needle: `${SHARED}/PROPOSALS.md` },
  { slug: "freelancer-revenue-engine", agentSlug: "project-manager", needle: `${SHARED}/CLIENTS.md` },
  { slug: "ecommerce-profit-maximizer", agentSlug: "store-commander", needle: `${SHARED}/SKUS.md` },
  { slug: "ecommerce-profit-maximizer", agentSlug: "pricing-intel", needle: `${SHARED}/SKUS.md` },
  { slug: "ecommerce-profit-maximizer", agentSlug: "ad-optimizer", needle: `${SHARED}/ADS.md` },
  { slug: "twitter-growth-machine", agentSlug: "content-writer", needle: `${SHARED}/VOICE.md` },
  { slug: "youtube-channel-os", agentSlug: "script-builder", needle: `${SHARED}/VOICE.md` },
  { slug: "newsletter-empire", agentSlug: "draft-writer", needle: `${SHARED}/VOICE.md` },
  { slug: "podcast-production-studio", agentSlug: "guest-researcher-booker", needle: `${SHARED}/GUEST_PIPELINE.md` },
  { slug: "b2b-sales-machine", agentSlug: "icp-researcher", needle: `${SHARED}/ICP.md` },
  { slug: "b2b-sales-machine", agentSlug: "sequence-writer", needle: `${SHARED}/SEQUENCES.md` },
  { slug: "agency-operations-os", agentSlug: "intake-scoping-agent", needle: `${SHARED}/SOW.md` },
  { slug: "founders-chief-of-staff", agentSlug: "briefing-compiler", needle: `${SHARED}/BRIEFING.md` },
  { slug: "seo-empire-builder", agentSlug: "keyword-strategist", needle: `${SHARED}/KEYWORDS.md` },
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
    expect(total).toBe(122)
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
