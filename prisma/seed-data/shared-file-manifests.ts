import type { SeedSharedFile, SeedTemplate } from "./types"

/**
 * INFRA-2 pipe-proving stubs. Waves deepen content; this PR proves the pipe.
 * memory/MEMORY.md on every template. Named files from Phase A.
 */

function stub(opts: {
  path: string
  title: string
  maintainedBy: string
  schema: string[]
  starter: string
}): SeedSharedFile {
  return {
    path: opts.path,
    content: `# ${opts.title}

Maintained by ${opts.maintainedBy}. Other agents read this file; only the maintainer writes it.

## Schema
${opts.schema.map((line) => `- ${line}`).join("\n")}

## Entries
${opts.starter}
`,
  }
}

function memoryMd(): SeedSharedFile {
  return stub({
    path: "memory/MEMORY.md",
    title: "MEMORY.md",
    maintainedBy: "this agent",
    schema: [
      "date: ISO date of the learning",
      "learning: durable fact or preference",
      "source: which run produced it",
    ],
    starter: "_No long-term learnings yet. Append dated bullets after each heartbeat._",
  })
}

const PORTFOLIO = stub({
  path: "PORTFOLIO.md",
  title: "PORTFOLIO.md",
  maintainedBy: "portfolio-tracker",
  schema: [
    "symbol: ticker or market id",
    "side: long | short",
    "qty: position size",
    "avgPrice: entry",
    "notes: risk / thesis pointer",
  ],
  starter: "_No open positions. Portfolio Tracker appends a row per fill._",
})

const VOICE_TWITTER = stub({
  path: "VOICE.md",
  title: "VOICE.md",
  maintainedBy: "content-writer",
  schema: [
    "tone: how the account sounds",
    "do: patterns to repeat",
    "dont: phrases and postures to avoid",
    "examples: short lines that match",
  ],
  starter: "_Voice rules empty until interview / WAVE-0. Content Writer maintains this file._",
})

const VOICE_YOUTUBE = stub({
  path: "VOICE.md",
  title: "VOICE.md",
  maintainedBy: "script-builder",
  schema: [
    "tone: on-camera / narration voice",
    "do: structures that fit the channel",
    "dont: off-brand phrasing",
    "examples: hook + closer lines",
  ],
  starter: "_Channel voice empty until interview. Script Builder maintains this file._",
})

const VOICE_NEWSLETTER = stub({
  path: "VOICE.md",
  title: "VOICE.md",
  maintainedBy: "draft-writer",
  schema: [
    "tone: editorial voice",
    "cadence: how issues open and close",
    "dont: off-brand phrasing",
    "examples: subject + lede samples",
  ],
  starter: "_Editorial voice empty until interview. Draft Writer maintains this file._",
})

const GUEST_PIPELINE = stub({
  path: "GUEST_PIPELINE.md",
  title: "GUEST_PIPELINE.md",
  maintainedBy: "guest-researcher-booker",
  schema: [
    "guest: name",
    "status: researched | outreached | booked | recorded",
    "topic: episode angle",
    "next: next action + date",
  ],
  starter: "_No guests yet. Guest Researcher & Booker owns this pipeline._",
})

const ICP = stub({
  path: "ICP.md",
  title: "ICP.md",
  maintainedBy: "icp-researcher",
  schema: [
    "segment: named ICP slice",
    "firmographics: size / industry / geo",
    "triggers: intent signals",
    "exclusions: do-not-target",
  ],
  starter: "_ICP empty until interview. ICP Researcher maintains this file._",
})

const SEQUENCE = stub({
  path: "SEQUENCE.md",
  title: "SEQUENCE.md",
  maintainedBy: "sequence-writer",
  schema: [
    "name: cadence id",
    "channel: email | linkedin | call",
    "touch: step number + delay",
    "purpose: why this touch exists",
  ],
  starter: "_No active cadence. Sequence Writer maintains this file._",
})

const CAPACITY = stub({
  path: "CAPACITY.md",
  title: "CAPACITY.md",
  maintainedBy: "resource-allocator",
  schema: [
    "person: name or role",
    "utilization: 0-100",
    "until: date allocation holds",
    "notes: skill / conflict",
  ],
  starter: "_No capacity rows. Resource Allocator maintains this file._",
})

const ACTION_LOG = stub({
  path: "ACTION_LOG.md",
  title: "ACTION_LOG.md",
  maintainedBy: "action-tracker",
  schema: [
    "item: commitment text",
    "owner: founder | team | external",
    "due: ISO date",
    "status: open | done | overdue",
  ],
  starter: "_No commitments yet. Action Tracker maintains this file._",
})

const CONTENT_CAL = stub({
  path: "CONTENT_CAL.md",
  title: "CONTENT_CAL.md",
  maintainedBy: "keyword-strategist",
  schema: [
    "date: publish target",
    "keyword: primary term",
    "intent: informational | commercial | transactional",
    "status: planned | drafted | shipped",
  ],
  starter: "_Calendar empty. Keyword Strategist maintains this file; Content Writer reads it._",
})

const MARKET = stub({
  path: "MARKET.md",
  title: "MARKET.md",
  maintainedBy: "market-intel-agent",
  schema: [
    "area: neighborhood or zip",
    "metric: DOM | inventory | list-to-sale",
    "value: latest reading",
    "asOf: ISO date",
  ],
  starter: "_No market rows. Market Intel Agent maintains this file._",
})

const LISTINGS = stub({
  path: "LISTINGS.md",
  title: "LISTINGS.md",
  maintainedBy: "listing-commander",
  schema: [
    "address: listing id or street",
    "status: active | pending | closed",
    "price: list price",
    "notes: showing / feedback",
  ],
  starter: "_No listings yet. Listing Commander maintains this inventory._",
})

const PROGRAM = stub({
  path: "PROGRAM.md",
  title: "PROGRAM.md",
  maintainedBy: "workout-planner",
  schema: [
    "block: mesocycle name",
    "days: session map",
    "lifts: primary movements",
    "notes: constraints from USER.md",
  ],
  starter: "_No training block yet. Workout Planner maintains this file._",
})

const LOG = stub({
  path: "LOG.md",
  title: "LOG.md",
  maintainedBy: "habit-recovery-tracker",
  schema: [
    "date: ISO date",
    "session: done | skipped",
    "sleep: hours + quality",
    "notes: soreness / energy",
  ],
  starter: "_No sessions logged. Habit & Recovery Tracker appends daily rows._",
})

/**
 * Named files per template slug (MEMORY.md is prepended by applySharedFiles).
 * Every one of the 20 slugs must appear - empty array = MEMORY.md only.
 */
export const TEMPLATE_NAMED_FILES: Record<string, SeedSharedFile[]> = {
  "quant-trader": [PORTFOLIO],
  "freelancer-revenue-engine": [],
  "ecommerce-profit-maximizer": [],
  "youtube-channel-os": [VOICE_YOUTUBE],
  "twitter-growth-machine": [VOICE_TWITTER],
  "newsletter-empire": [VOICE_NEWSLETTER],
  "podcast-production-studio": [GUEST_PIPELINE],
  "b2b-sales-machine": [ICP, SEQUENCE],
  "agency-operations-os": [CAPACITY],
  "founders-chief-of-staff": [ACTION_LOG],
  "seo-empire-builder": [CONTENT_CAL],
  "real-estate-agent-os": [MARKET, LISTINGS],
  "recruiter-os": [],
  "medical-practice-manager": [],
  "law-firm-intake-os": [],
  "home-services-dispatcher": [],
  "health-fitness-commander": [PROGRAM, LOG],
  "student-accelerator": [],
  "job-hunter-os": [],
  "developer-productivity-os": [],
}

export function applySharedFiles(template: SeedTemplate): SeedTemplate {
  const named = TEMPLATE_NAMED_FILES[template.slug]
  if (!named) {
    throw new Error(`TEMPLATE_NAMED_FILES missing slug ${template.slug}`)
  }
  return { ...template, files: [memoryMd(), ...named] }
}
