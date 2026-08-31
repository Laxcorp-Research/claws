import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { ALL_SKILLS } from "../../prisma/seed-data/skills-index"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import { TWITTER_API_402_COPY } from "@/lib/tools/twitter-api-honesty"
import { INVENTED_USER_EVENT_FIXTURE } from "../../prisma/seed-data/wave-0-twitter"

function twitter() {
  const t = ALL_TEMPLATES.find((x) => x.slug === "twitter-growth-machine")
  if (!t) throw new Error("twitter-growth-machine missing")
  return t
}

function agent(slug: string) {
  const a = twitter().agents.find((x) => x.agentSlug === slug)
  if (!a) throw new Error(slug)
  return a
}

describe("WAVE-0 Twitter/X flagship prose contracts", () => {
  it("Content Writer has worked hook examples, a full thread, banned list, and GOOD vs BAD", () => {
    const soul = agent("content-writer").soulMd
    expect(soul).toContain("Hook anatomy (5 patterns)")
    expect(soul).toContain("We killed 11 agent evals last month. 9 were theater.")
    expect(soul).toContain("I used to demo the happy path. That's why nobody trusted the claw.")
    expect(soul).toContain("If your agent team cannot fail in front of you, you do not have a team.")
    expect(soul).toContain("Stop writing 'unpopular opinion' above a popular opinion.")
    expect(soul).toContain("Standup: 6 agents, 0 owners, a green dashboard, a missed customer.")
    expect(soul).toContain("We don't demo vapor anymore. Here's the rule that made the claw honest.")
    expect(soul).toContain("Banned-cadence list")
    expect(soul).toContain("unpopular opinion:")
    expect(soul).toContain("Guru-speak")
    expect(soul).toContain("GOOD vs BAD")
    expect(soul).toContain("WHY:")
  })

  it("Content Writer grounding law: no invented facts; placeholder when unsourced", () => {
    const soul = agent("content-writer").soulMd
    expect(soul).toContain("Grounding law")
    expect(soul).toContain("NEVER invent numbers")
    expect(soul).toContain("ACTIONS/EVENTS about the user")
    expect(soul).toContain("[YOUR NUMBER HERE]")
    expect(soul).toContain("one-line ask")
    expect(soul).toContain("USER.md")
    expect(soul).toContain("VOICE.md")
    expect(agent("content-writer").agentsMd).toContain("[YOUR NUMBER HERE]")
  })

  it("critic + writer catch invented user ACTIONS/EVENTS, not just numbers (MUTATION: number-only anchor → fail)", () => {
    const writer = agent("content-writer").soulMd
    const critic = agent("social-content-reviewer").soulMd
    expect(INVENTED_USER_EVENT_FIXTURE).toContain("Agent Seer")
    expect(writer).toContain("ACTIONS/EVENTS about the user")
    expect(writer).toContain(INVENTED_USER_EVENT_FIXTURE)
    expect(critic).toContain("invented ACTIONS/EVENTS about the user")
    expect(critic).toContain(INVENTED_USER_EVENT_FIXTURE)
    expect(writer).toContain("NEVER invent numbers")
    expect(critic).toContain("specific factual claim with no source")
  })

  it("Social Content Reviewer names 4 dimensions, rejection format, and instant-reject list", () => {
    const soul = agent("social-content-reviewer").soulMd
    expect(soul).toContain("voice-match")
    expect(soul).toContain("specificity")
    expect(soul).toContain("hook-strength")
    expect(soul).toContain("risk")
    expect(soul).toContain("ONE thing to fix")
    expect(soul).toContain("Rewritten example line")
    expect(soul).toContain("Instant-reject list")
    expect(soul).toContain("Engagement-bait")
    expect(soul).toContain("USER.md do-nots")
    expect(soul).toContain("qualityThreshold")
    expect(soul).toContain("specific factual claim with no source in files/tools")
  })

  it("Commander has capacity, escalation, tool errors, and same-session first-mission", () => {
    const soul = agent("twitter-commander").soulMd
    expect(soul).toContain("Max 8 drafts per day")
    expect(soul).toContain("Go quiet")
    expect(soul).toContain("Ratio detected")
    expect(soul).toContain("Viral-response protocol")
    expect(soul).toContain("twitter-api 429")
    expect(soul).toContain("twitter-api 402")
    expect(soul).toContain(TWITTER_API_402_COPY)
    expect(soul).toContain("mini first-mission")
    expect(soul).toContain("2 draft posts")
    expect(soul).toContain("pasted verbatim")
    expect(soul).toContain("drafted, awaiting your approval for 4 PM")
    expect(soul.toLowerCase()).not.toContain("queued for 4 pm")
  })

  it("reply prose pastes deliverables; missions keep host paths (MUTATION: file-only delivery → fail)", () => {
    const soul = agent("twitter-commander").soulMd
    const heartbeat = agent("twitter-commander").heartbeatMd
    expect(soul).toContain("Writing a file is not delivery")
    expect(soul).toContain("pasted verbatim")
    expect(soul).not.toContain("saved x-content-cycle to your deliverables")
    expect(heartbeat).toContain("paste")
    expect(heartbeat).toContain("verbatim")
    expect(heartbeat).toContain("/home/node/.openclaw/shared/deliverables/")
    expect(heartbeat).toContain("drafted, awaiting your approval")
    expect(heartbeat.toLowerCase()).not.toContain("queue the approved")
  })

  it("Scout has signal-vs-noise tree, recency windows, and USER.md do-not bind", () => {
    const soul = agent("trend-topic-scout").soulMd
    expect(soul).toContain("Signal-vs-noise decision tree")
    expect(soul).toContain("everyone-is-tweeting-it")
    expect(soul).toContain("0-90 min")
    expect(soul).toContain("USER.md do-not")
    expect(soul).toContain("HOT SIGNAL")
    expect(soul).toContain("NOISE")
  })

  it("Engagement has rubric, timing, and 3-tier targets", () => {
    const soul = agent("engagement-strategist").soulMd
    expect(soul).toContain("Reply-worthiness rubric")
    expect(soul).toContain("Timing logic")
    expect(soul).toContain("Tier 1")
    expect(soul).toContain("Tier 2")
    expect(soul).toContain("Tier 3")
  })

  it("Analytics has metric definitions, dip discipline, weekly synthesis", () => {
    const soul = agent("analytics-growth-tracker").soulMd
    expect(soul).toContain("Metric definitions")
    expect(soul).toContain("ER:")
    expect(soul).toContain("Single-day-dip discipline")
    expect(soul).toContain("DIP - no strategy change")
    expect(soul).toContain("Weekly synthesis format")
  })

  it("deliverable files embed a filled Example (MUTATION: drop ## Example → fail)", () => {
    const files = twitter().files ?? []
    for (const name of [
      "shared/deliverables/x-morning-trends.md",
      "shared/deliverables/x-content-cycle.md",
      "shared/deliverables/x-daily-recap.md",
    ]) {
      const file = files.find((f) => f.path === name)
      expect(file, name).toBeDefined()
      expect(file!.content.length).toBeLessThan(8000)
      expect(file!.content).toContain("## Example")
      expect(file!.content).toContain("## 2026-08-28")
      expect(file!.content).toContain("## Format")
    }
    const voice = files.find((f) => f.path === "shared/VOICE.md")
    expect(voice).toBeDefined()
    expect(voice!.content.length).toBeLessThan(8000)
    expect(voice!.content).toContain("## Example")
    expect(voice!.content).toContain("## Voice pillars")
    expect(voice!.content).toContain(
      "Content Writer updates this when the human approves posts",
    )
  })

  it("critic knob stays 8; factory dimensions stay gone", () => {
    expect(agent("social-content-reviewer").qualityThreshold ?? 8).toBe(8)
    const soul = agent("social-content-reviewer").soulMd
    expect(soul).not.toContain("Content Value")
    expect(soul).not.toContain("Engagement Potential")
    expect(agent("twitter-commander").soulMd).not.toContain("Consistency compounds")
  })

  it("twitter-api SKILL.md is craft not thin post-curl; tavily has scout patterns", () => {
    const twitterSkill = ALL_SKILLS.find((s) => s.slug === "twitter-api")
    const tavily = ALL_SKILLS.find((s) => s.slug === "tavily-search")
    expect(twitterSkill?.skillMd).toContain("Endpoints used per mission")
    expect(twitterSkill?.skillMd).toContain("What NOT to fetch")
    expect(twitterSkill?.skillMd).toContain("429")
    expect(twitterSkill?.skillMd).toContain(TWITTER_API_402_COPY)
    expect(twitterSkill?.skillMd).not.toContain("Hello from LaxClaws")
    expect(tavily?.skillMd).toContain("Scout query patterns")
    expect(tavily?.skillMd).toContain("Corroborate")
    expect(tavily?.skillMd).toContain(TWITTER_API_402_COPY)
  })

  it("three windows stay parseable scripts with failure branches", () => {
    const scripts = parseHeartbeatWindowScripts(agent("twitter-commander").heartbeatMd)
    expect(scripts).toHaveLength(3)
    for (const script of scripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(3)
      expect(script.deliverable).toContain("shared/deliverables/")
    }
    const md = agent("twitter-commander").heartbeatMd
    expect(md).toContain("429")
    expect(md).toContain("DEGRADED")
    expect(md).toContain("twitter-api")
    expect(md).toContain("tavily-search")
    expect(md).toContain("twitter-api 402")
    expect(md).toContain(TWITTER_API_402_COPY)
    expect(md.toLowerCase()).not.toMatch(/402[\s\S]{0,80}reconnect/)
    expect(md).toContain("Stall guard")
    expect(md).toContain("20 minutes")
  })
})
