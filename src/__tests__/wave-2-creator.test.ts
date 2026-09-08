import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  INVENTED_CTR_FIXTURE,
  INVENTED_RETENTION_FIXTURE,
  YOUTUBE_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-2-youtube"
import {
  INVENTED_LIST_FIXTURE,
  INVENTED_OPEN_RATE_FIXTURE,
  NEWSLETTER_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-2-newsletter"
import {
  INVENTED_DOWNLOAD_FIXTURE,
  INVENTED_GUEST_FIXTURE,
  PODCAST_FIRST_MISSION_PROSE,
} from "../../prisma/seed-data/wave-2-podcast"
import {
  CLAIMS_TABLE_STEP_MARKER,
  NEWSLETTER_CRITIC_SCORE_DIMENSIONS,
  PODCAST_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
  YOUTUBE_CRITIC_SCORE_DIMENSIONS,
} from "@/lib/critic/claims-table"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"
import { AUTONOMOUS_CAPABLE_TOOLS } from "@/lib/openclaw/delivery-rail"

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

describe("WAVE-2 YouTube Channel OS prose contracts", () => {
  const slug = "youtube-channel-os"

  it("Channel Operator personality, no factory philosophy, approval wording", () => {
    const soul = agent(slug, "channel-commander").soulMd
    expect(soul).toContain("You are Channel Operator")
    expect(soul).toContain("mini first-mission")
    expect(soul).toContain("drafted, awaiting your approval to change the video")
    expect(soul).toContain("Critic approval is not human approval")
    expect(soul).not.toContain("Consistency beats virality")
    expect(agent(slug, "channel-commander").heartbeatMd).toContain("Never a /home/node/.openclaw/ path")
  })

  it("interview covers handle", () => {
    const pack = getInterviewPack(slug)!
    expect(pack.map((q) => q.id)).toEqual(expect.arrayContaining(["handle", "channel", "voice"]))
  })

  it("Title Architect has CTR 1-10 rubric with GOOD vs BAD examples", () => {
    const soul = agent(slug, "title-thumbnail-architect").soulMd
    expect(soul).toContain("Title CTR rubric")
    expect(soul).toContain("GOOD 8")
    expect(soul).toContain("BAD:")
    expect(soul).toContain("Thumbnail brief format")
    expect(soul).toContain(INVENTED_CTR_FIXTURE)
  })

  it("Script Builder has GOOD vs BAD retention anatomy", () => {
    const soul = agent(slug, "script-builder").soulMd
    expect(soul).toContain("Retention script anatomy")
    expect(soul).toContain("GOOD hook")
    expect(soul).toContain("BAD hook")
    expect(soul).toContain(INVENTED_RETENTION_FIXTURE)
  })

  it("critic is hook / retention-logic / originality / policy", () => {
    const soul = agent(slug, "content-quality-gate").soulMd
    for (const dim of YOUTUBE_CRITIC_SCORE_DIMENSIONS) {
      expect(soul).toContain(dim)
    }
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain("| Claim | Source |")
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).toContain(INVENTED_CTR_FIXTURE)
    expect(soul).toMatch(/\bPASS\b/)
    expect(soul).toMatch(/\bREJECT\b/)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    expectNamedFiles(slug, [
      "shared/VIDEOS.md",
      "shared/IDEAS.md",
      "shared/CALENDAR.md",
      "shared/deliverables/scored-titles.md",
      "shared/deliverables/script-draft.md",
      "shared/deliverables/seo-metadata.md",
    ])
  })

  it("six windows stay parseable with failure branches", () => {
    const scripts = parseHeartbeatWindowScripts(agent(slug, "channel-commander").heartbeatMd)
    expect(scripts).toHaveLength(6)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 7 * * *",
      "30 7 * * *",
      "0 9 * * *",
      "0 11 * * *",
      "0 13 * * *",
      "0 19 * * *",
    ])
    for (const script of scripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(3)
      expect(script.deliverable.length).toBeGreaterThan(0)
    }
    const md = agent(slug, "channel-commander").heartbeatMd
    expect(md).toContain("DEGRADED")
    expect(md).toContain("YOUTUBE_UPDATE_VIDEO")
    expect(md).toContain("scored-titles.md")
  })

  it("youtube-data-api SKILL.md carries Channel OS craft and ACTION gating", () => {
    const youtube = ALL_SKILLS.find((s) => s.slug === "youtube-data-api")
    expect(youtube?.skillMd).toContain("YouTube Channel OS path")
    expect(youtube?.skillMd).toContain("http tool")
    expect(youtube?.skillMd).toContain("YOUTUBE_UPDATE_VIDEO")
    expect(youtube?.skillMd).toContain(INVENTED_CTR_FIXTURE)
  })

  it("post-interview mini-mission is scored titles + critic in the same session", () => {
    const pack = getInterviewPack(slug)!
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: slug,
    })
    expect(pending).toContain(YOUTUBE_FIRST_MISSION_PROSE)
    expect(pending).toContain("scored 1-10 title set")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8; exec stays non-autonomous", () => {
    expect(agent(slug, "content-quality-gate").qualityThreshold).toBe(8)
    expect(AUTONOMOUS_CAPABLE_TOOLS).toEqual([])
    expect(agent(slug, "channel-commander").soulMd).toContain(
      "Never PATCH YouTube metadata without a human-approved ACTION card",
    )
  })
})

describe("WAVE-2 Newsletter Empire prose contracts", () => {
  const slug = "newsletter-empire"

  it("Editor personality, deliverability CRISIS, approval wording", () => {
    const soul = agent(slug, "newsletter-commander").soulMd
    expect(soul).toContain("You are Editor")
    expect(soul).toContain("Deliverability crisis")
    expect(soul).toContain("drafted, awaiting your approval to send the issue")
    expect(soul).toContain("CRISIS")
    expect(soul).not.toContain("Consistency beats virality")
  })

  it("Draft Writer has subject 1-10 rubric and issue anatomy", () => {
    const soul = agent(slug, "draft-writer").soulMd
    expect(soul).toContain("Subject-line open-rate rubric")
    expect(soul).toContain("GOOD 8")
    expect(soul).toContain("Issue anatomy")
    expect(soul).toContain(INVENTED_OPEN_RATE_FIXTURE)
  })

  it("critic is subject-promise / issue-density / voice-fit / policy", () => {
    const soul = agent(slug, "editorial-quality-gate").soulMd
    for (const dim of NEWSLETTER_CRITIC_SCORE_DIMENSIONS) {
      expect(soul).toContain(dim)
    }
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).toContain(INVENTED_LIST_FIXTURE)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    expectNamedFiles(slug, [
      "shared/ISSUES.md",
      "shared/SUBSCRIBERS.md",
      "shared/deliverables/issue-draft.md",
      "shared/deliverables/sponsor-pitch.md",
    ])
  })

  it("four weekday windows stay parseable with CRISIS branch", () => {
    const scripts = parseHeartbeatWindowScripts(agent(slug, "newsletter-commander").heartbeatMd)
    expect(scripts).toHaveLength(4)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 8 * * 1-5",
      "0 10 * * 1-5",
      "0 14 * * 1-5",
      "0 16 * * 1-5",
    ])
    const md = agent(slug, "newsletter-commander").heartbeatMd
    expect(md).toContain("CRISIS")
    expect(md).toContain("issue-draft.md")
    expect(md).toContain("DEGRADED")
  })

  it("beehiiv-api SKILL.md is http-tool only (no curl) and gates POST", () => {
    const beehiiv = ALL_SKILLS.find((s) => s.slug === "beehiiv-api")
    expect(beehiiv?.skillMd).toContain("http tool")
    expect(beehiiv?.skillMd).toContain("ACTION")
    expect(beehiiv?.skillMd).toContain("$BEEHIIV_API_KEY")
    expect(beehiiv?.skillMd).toContain("$BEEHIIV_PUBLICATION_ID")
    expect(beehiiv?.skillMd).not.toMatch(/\bcurl\b/)
    expect(beehiiv?.compatibleTools).toEqual(["beehiiv-api"])
  })

  it("post-interview mini-mission is issue draft + critic in the same session", () => {
    const pack = getInterviewPack(slug)!
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: slug,
    })
    expect(pending).toContain(NEWSLETTER_FIRST_MISSION_PROSE)
    expect(pending).toContain("issue draft")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8", () => {
    expect(agent(slug, "editorial-quality-gate").qualityThreshold).toBe(8)
  })
})

describe("WAVE-2 Podcast Production Studio prose contracts", () => {
  const slug = "podcast-production-studio"

  it("Showrunner personality, guest rubric, approval wording", () => {
    const soul = agent(slug, "podcast-commander").soulMd
    expect(soul).toContain("You are Showrunner")
    expect(soul).toContain("drafted, awaiting your approval to send the email")
    expect(soul).toContain("GMAIL_SEND_EMAIL")
    expect(soul).not.toContain("Consistency beats virality")
  })

  it("Guest Researcher has 1-10 rubric; planner has interview brief", () => {
    expect(agent(slug, "guest-researcher-booker").soulMd).toContain("Guest scoring rubric")
    expect(agent(slug, "guest-researcher-booker").soulMd).toContain(INVENTED_GUEST_FIXTURE)
    expect(agent(slug, "episode-planner").soulMd).toContain("Interview brief format")
    expect(agent(slug, "content-repurposer").soulMd).toContain("10-20 piece")
    expect(agent(slug, "content-repurposer").soulMd).toContain(INVENTED_DOWNLOAD_FIXTURE)
  })

  it("critic is guest-fit / brief-clarity / repurpose-plan / policy", () => {
    const soul = agent(slug, "podcast-quality-gate").soulMd
    for (const dim of PODCAST_CRITIC_SCORE_DIMENSIONS) {
      expect(soul).toContain(dim)
    }
    expect(soul).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(soul).toContain(STRICT_8_DEFINITION)
    expect(soul).not.toMatch(/present best-with-warning/)
  })

  it("named + deliverable files embed Schema, Format, and a filled Example", () => {
    expectNamedFiles(slug, [
      "shared/SHOW_BIBLE.md",
      "shared/GUEST_PIPELINE.md",
      "shared/deliverables/guest-brief.md",
      "shared/deliverables/repurpose-plan.md",
    ])
  })

  it("Mon/Wed/Fri windows stay parseable", () => {
    const scripts = parseHeartbeatWindowScripts(agent(slug, "podcast-commander").heartbeatMd)
    expect(scripts).toHaveLength(5)
    expect(scripts.map((s) => s.cron)).toEqual([
      "0 8 * * 1",
      "0 10 * * 1",
      "0 12 * * 3",
      "0 14 * * 5",
      "0 16 * * 5",
    ])
    const md = agent(slug, "podcast-commander").heartbeatMd
    expect(md).toContain("guest-brief.md")
    expect(md).toContain("GMAIL_SEND_EMAIL")
    expect(md).toContain("DEGRADED")
  })

  it("post-interview mini-mission is guest brief + critic in the same session", () => {
    const pack = getInterviewPack(slug)!
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack,
      templateSlug: slug,
    })
    expect(pending).toContain(PODCAST_FIRST_MISSION_PROSE)
    expect(pending).toContain("guest brief")
    expect(pending).toContain("same session")
  })

  it("critic knob stays 8", () => {
    expect(agent(slug, "podcast-quality-gate").qualityThreshold).toBe(8)
  })
})
