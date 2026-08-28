import type { SeedSharedFile, SeedTemplate } from "./types"

/**
 * INFRA-1: per-template interview coverage packs.
 * Packs are a conversation guide for the orchestrator, not a form.
 * docs/claw-specs/ Supplement packs were absent (Card 37); these packs
 * are mined from docs/TEMPLATE_SUPERPOWER_PHASE_A.md per-template gaps.
 */

export interface InterviewQuestion {
  id: string
  prompt: string
  coverage: string
}

function q(id: string, prompt: string, coverage: string): InterviewQuestion {
  return { id, prompt, coverage }
}

export const TEMPLATE_INTERVIEW_PACKS: Record<string, InterviewQuestion[]> = {
  "quant-trader": [
    q("universe", "Which markets and instruments are in-bounds (equities, crypto, perps, prediction markets)?", "tradable universe"),
    q("accounts", "Which brokerage or exchange accounts should the claw use, and which are paper vs live?", "account map"),
    q("risk_floors", "What is max position size, daily loss limit, and kill-switch rule?", "risk floors"),
    q("horizon", "Typical hold time and whether overnight risk is allowed?", "horizon"),
    q("reporting", "How do you want P&L reported (cadence, currency, what to flag)?", "reporting prefs"),
  ],
  "freelancer-revenue-engine": [
    q("niche", "What services do you sell, and who is the ideal client?", "niche"),
    q("rate", "Floor rate, target rate, and anything you will not bid?", "rate card"),
    q("platforms", "Where do you hunt (Upwork, LinkedIn, inbound, all)?", "platforms"),
    q("proof", "2-3 wins or portfolio pieces the claw should cite?", "proof"),
    q("voice", "How should proposals sound (direct, warm, technical)?", "proposal voice"),
  ],
  "ecommerce-profit-maximizer": [
    q("store", "Store URL, platform (Shopify etc.), and primary markets?", "store"),
    q("margins", "Target gross margin and SKUs that are sacred vs flexible?", "margins"),
    q("brand", "Brand voice, claims you never make, competitors to watch?", "brand"),
    q("ads", "Paid channels in play and monthly ceiling?", "ads"),
    q("ops", "Who handles fulfillment and what should never be auto-discounted?", "ops constraints"),
  ],
  "youtube-channel-os": [
    q("channel", "Channel name, niche, and who the viewer is?", "channel"),
    q("format", "Typical video length, series vs one-offs, upload cadence?", "format"),
    q("voice", "On-camera / narration voice: do and don't?", "voice"),
    q("proof", "2-3 videos that are on-brand?", "proof"),
    q("goals", "Subscriber / views goal for the next 90 days?", "goals"),
  ],
  "twitter-growth-machine": [
    q("niche", "What is this account about, in one sentence a stranger would understand?", "niche"),
    q("audience", "Who should follow you, and who should we not chase?", "audience"),
    q("cadence", "Posts per day, thread vs single, and posting windows?", "cadence"),
    q("voice", "How should the account sound? Any phrases that are on-brand?", "voice"),
    q("do_not", "Topics, jokes, or postures that are off-limits?", "do-not"),
    q("proof", "2-4 posts or threads that are the bar?", "proof posts"),
    q("goals", "What does a good week look like (followers, replies, a specific outcome)?", "goals"),
  ],
  "newsletter-empire": [
    q("audience", "Who is the reader and what do they hire this newsletter to do?", "audience"),
    q("cadence", "Send day/time, issue length, and free vs paid split?", "cadence"),
    q("voice", "Editorial voice: do / don't / subject-line style?", "voice"),
    q("proof", "2 issues that hit the bar?", "proof"),
    q("monetize", "How this makes money (sponsors, paid tier, products)?", "monetize"),
  ],
  "podcast-production-studio": [
    q("show", "Show name, one-line premise, and episode length?", "show bible"),
    q("guests", "Ideal guest profile and anyone who is a hard no?", "guest profile"),
    q("cadence", "Publish day and how far ahead you book?", "cadence"),
    q("voice", "Host tone on-mic: curious, combative, teaching?", "voice"),
    q("distribution", "Where episodes go (RSS, YouTube, clips) and what to clip?", "distribution"),
  ],
  "b2b-sales-machine": [
    q("icp", "Ideal customer: industry, size, geo, title, and exclusions?", "ICP"),
    q("offer", "What you sell and the outcome you promise?", "offer"),
    q("channels", "Email / LinkedIn / call mix and daily send cap?", "channels"),
    q("proof", "2-3 case studies or logos we may cite?", "proof"),
    q("compliance", "Anything that would get a domain banned or a lawyer involved?", "compliance"),
  ],
  "agency-operations-os": [
    q("roles", "Team roles, who is billable, and who is leadership?", "roles"),
    q("utilization", "Target utilization and what counts as admin?", "utilization"),
    q("margin", "Margin floor per project and when to refuse work?", "margin floor"),
    q("clients", "Active retainers vs project work, and VIP clients?", "clients"),
    q("tools", "PM tool of record (Linear, Asana, none)?", "tools"),
  ],
  "founders-chief-of-staff": [
    q("briefing", "Morning briefing shape: length, order, what to omit?", "briefing shape"),
    q("vips", "VIP list (always interrupt) vs mute list?", "VIP / mute"),
    q("commitments", "How you track yeses (tool, owner default, overdue rule)?", "commitments"),
    q("voice", "How should outbound from you sound?", "comms voice"),
    q("off_limits", "Topics the claw must never send without you?", "off-limits"),
  ],
  "seo-empire-builder": [
    q("property", "Site URL, CMS, and locales?", "property"),
    q("icp_search", "Who searches, and which intents are money vs vanity?", "search ICP"),
    q("ymyl", "Any YMYL topics that need human expert review?", "YMYL"),
    q("cadence", "Publish cadence and who approves?", "cadence"),
    q("competitors", "3 competitors we should not clone blindly?", "competitors"),
  ],
  "real-estate-agent-os": [
    q("market", "Farm area (zips / neighborhoods) and residential vs commercial?", "market"),
    q("license", "License, brokerage, and required disclaimers?", "license"),
    q("voice", "Client-comms tone and phrases that violate Fair Housing?", "voice"),
    q("leads", "Lead sources and speed-to-lead target?", "leads"),
    q("inventory", "Active listings we must always be accurate about?", "inventory"),
  ],
  "recruiter-os": [
    q("desks", "Roles you recruit, seniority, and geos?", "desks"),
    q("employers", "Client companies / hiring managers and must-not-poach lists?", "employers"),
    q("compliance", "Anti-discrimination rules you want restated in your words?", "compliance"),
    q("voice", "Outbound to candidates vs clients: tone?", "voice"),
    q("ats", "ATS of record, or none yet?", "ATS"),
  ],
  "medical-practice-manager": [
    q("practice", "Specialty, locations, and hours?", "practice"),
    q("hipaa", "Who is the privacy officer and what must never leave the clinic systems?", "HIPAA"),
    q("recall", "Recall / reminder cadence and channels allowed?", "recall"),
    q("voice", "Patient-comms tone; anything clinical the claw must not advise?", "voice"),
    q("ehr", "EHR in use, or none connected yet?", "EHR"),
  ],
  "law-firm-intake-os": [
    q("matters", "Practice areas you take, and what you refer out?", "matters"),
    q("jurisdiction", "Jurisdictions and bar constraints the claw must respect?", "jurisdiction"),
    q("intake", "What a complete intake looks like before a lawyer sees it?", "intake"),
    q("voice", "Client-facing tone; never-give-legal-advice line?", "voice"),
    q("conflicts", "How conflicts are checked today?", "conflicts"),
  ],
  "home-services-dispatcher": [
    q("trades", "Trades you run (HVAC, plumbing, etc.) and service area?", "trades"),
    q("hours", "Business hours, emergency definition, after-hours rule?", "hours"),
    q("techs", "Who is on the roster and skill tags?", "techs"),
    q("voice", "Customer SMS/call tone; anything you never promise?", "voice"),
    q("dispatch", "How jobs are assigned today (round-robin, skill, geo)?", "dispatch"),
  ],
  "health-fitness-commander": [
    q("goals", "Training goal for the next 12 weeks (strength, fat loss, event)?", "goals"),
    q("equipment", "Equipment you have (home, gym, none)?", "equipment"),
    q("schedule", "Days you can train, session length, and hard no-go times?", "schedule"),
    q("constraints", "Injuries, pain, medical limits the claw must never ignore?", "constraints"),
    q("log", "What you will actually log daily (workout, sleep, both)?", "logging"),
  ],
  "student-accelerator": [
    q("program", "School, program, and term dates?", "program"),
    q("courses", "Current courses and which ones are on fire?", "courses"),
    q("deadlines", "Known deadlines this term?", "deadlines"),
    q("integrity", "Citation style and what counts as cheating in your program?", "integrity"),
    q("hours", "Study hours you actually have on weekdays vs weekend?", "hours"),
  ],
  "job-hunter-os": [
    q("target", "Target titles, companies, geos, and remote vs on-site?", "target profile"),
    q("floor", "Comp floor, must-haves, and deal-breakers?", "floor"),
    q("story", "3 bullets of your story a recruiter should hear first?", "story"),
    q("pipeline", "Where you apply today (LinkedIn, referrals, agencies)?", "pipeline"),
    q("constraints", "Notice period, visa, or schedule constraints?", "constraints"),
  ],
  "developer-productivity-os": [
    q("stack", "Languages, repos, and the system of record (GitHub org)?", "stack"),
    q("cadence", "Standup time, review SLA, and on-call expectations?", "cadence"),
    q("bar", "What a good PR looks like on this team?", "review bar"),
    q("pages", "How incidents are declared and who to page?", "incidents"),
    q("off_limits", "Repos or secrets the claw must never touch?", "off-limits"),
  ],
}

function userMdStub(): SeedSharedFile {
  return {
    path: "shared/USER.md",
    content: `# USER.md

Maintained by the orchestrator from the first-boot interview. Other agents read this file; only the orchestrator writes it. The human can say "update my profile" to rewrite it.

## Schema
- id: question id from the template pack
- coverage: what this answer is for
- prompt: what was asked
- answer: the human's reply

## Entries
_Interview not yet completed._
`,
  }
}

export function applyInterviewSeed(template: SeedTemplate): SeedTemplate {
  const pack = TEMPLATE_INTERVIEW_PACKS[template.slug]
  if (!pack || pack.length === 0) {
    throw new Error(`TEMPLATE_INTERVIEW_PACKS missing slug ${template.slug}`)
  }
  const existing = template.files ?? []
  if (existing.some((f) => f.path === "shared/USER.md")) return template
  return { ...template, files: [...existing, userMdStub()] }
}
