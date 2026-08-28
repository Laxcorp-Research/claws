import type { SeedTemplate } from "./types"

/**
 * INFRA-4 baseline mission scripts. Waves polish category excellence.
 * Every orchestrator HEARTBEAT.md is window sections (`## window <cron>`)
 * with numbered steps and a Deliverable line.
 */

const SHARED = "/home/node/.openclaw/shared"

export const FORMERLY_EMPTY_TEMPLATE_SLUGS = [
  "real-estate-agent-os",
  "recruiter-os",
  "medical-practice-manager",
  "law-firm-intake-os",
  "home-services-dispatcher",
  "health-fitness-commander",
  "student-accelerator",
  "job-hunter-os",
  "developer-productivity-os",
] as const

function windowBlock(expr: string, steps: string[], deliverable: string): string {
  const numbered = steps.map((step, i) => `${i + 1}. ${step}`).join("\n")
  return `${`## window ${expr}`}\n${numbered}\nDeliverable: ${deliverable}`
}

function missionDoc(windows: string[]): string {
  return `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

${windows.join("\n\n")}
`
}

function wake(files: string[]): string {
  const paths = files.map((f) => `${SHARED}/${f}`).join(" and ")
  return `Wake. Read ${paths}.`
}

function memory(): string {
  return "Write a dated outcome line to this agent's memory/MEMORY.md."
}

const USER = "USER.md"

export const TEMPLATE_MISSION_SCRIPTS: Record<string, string> = {
  "quant-trader": missionDoc([
    windowBlock(
      "*/30 8-16 * * 1-5",
      [
        wake([USER, "PORTFOLIO.md"]),
        "Use tavily-search plus the attached venue skills (polymarket-trading, binance-trading, coinbase-trading, alpaca-trading) via Market Scanner to list in-universe moves since the last tick.",
        "Delegate signal scoring to Signal Analyst and size/kill-switch check to Risk Manager per the canvas. Backtester only if a rule change is proposed.",
        "Critic gate: Trade Thesis Reviewer must score the thesis before any live ticket is treated as ready. Paper vs live follows USER.md.",
        "Ask Portfolio Tracker to refresh shared/PORTFOLIO.md with fills and open risk.",
        memory(),
      ],
      "shared/deliverables/market-hours-scan.md (opportunities, rejected names, and whether a ticket is blocked)",
    ),
  ]),

  "freelancer-revenue-engine": missionDoc([
    windowBlock(
      "0 9,13,17 * * 1-5",
      [
        wake([USER]),
        "Use tavily-search via Lead Hunter to find in-niche leads that clear the USER.md rate floor.",
        "Delegate a proposal draft to Proposal Writer (project-scoping) and a next-step date to Project Manager (google-calendar, gmail-ops) per the canvas.",
        "If invoices are due, delegate chase copy to Invoice & Collections (gmail-ops) without inventing balances.",
        "Critic gate: Business Development Reviewer must approve outbound before send.",
        memory(),
      ],
      "shared/deliverables/pipeline-cycle.md (leads touched, proposal status, invoice follow-ups)",
    ),
  ]),

  "ecommerce-profit-maximizer": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER]),
        "Use tavily-search via Product Researcher for demand notes, then Shopify-store skills on Listing Optimizer, Pricing Intel, Review Manager, and Ad Optimizer per the canvas.",
        "Do not auto-discount SKUs USER.md marks sacred. Flag margin floor breaches.",
        "Critic gate: Ecommerce Quality Gate reviews claims and pricing before anything is treated as live.",
        memory(),
      ],
      "shared/deliverables/daily-store-brief.md (revenue notes, price checks, review queue, ad pauses)",
    ),
  ]),

  "youtube-channel-os": missionDoc([
    windowBlock(
      "0 7 * * *",
      [
        wake([USER, "VOICE.md"]),
        "Use youtube-data-api and tavily-search via Trend Scout, then Idea Generator, for today's angles that match VOICE.md.",
        "Delegate title/thumbnail language to Title & Thumbnail Architect and a script outline to Script Builder per the canvas. YouTube SEO Optimizer names tags only after the outline exists.",
        "Critic gate: Content Quality Gate must approve before a title or hook is treated as ready to film.",
        memory(),
      ],
      "shared/deliverables/yt-morning-slate.md (ranked ideas, recommended title, next film note)",
    ),
  ]),

  "twitter-growth-machine": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER, "VOICE.md"]),
        "Use twitter-api and tavily-search via Trend & Topic Scout for niche opportunities that respect USER.md do-not topics.",
        "Delegate a first-draft slate to Content Writer (twitter-api) per the canvas. Do not post.",
        "Critic gate: Social Content Reviewer must approve voice and risk before anything is scheduled.",
        memory(),
      ],
      "shared/deliverables/x-morning-trends.md (top opportunities and one recommended first post)",
    ),
    windowBlock(
      "0 12,16,20 * * *",
      [
        wake([USER, "VOICE.md"]),
        "Use twitter-api via Content Writer and Engagement Strategist to draft the next scheduled item and a reply plan.",
        "Delegate timing/reply choices to Engagement Strategist per the canvas. Stay inside USER.md cadence.",
        "Critic gate: Social Content Reviewer rejects off-voice or engagement-bait.",
        memory(),
      ],
      "shared/deliverables/x-content-cycle.md (drafts queued, replies suggested, items held)",
    ),
    windowBlock(
      "0 21 * * *",
      [
        wake([USER, "VOICE.md"]),
        "Use twitter-api via Analytics & Growth Tracker for today's follower, reply, and post stats against USER.md weekly goals.",
        "Do not change strategy from a single-day dip. Flag only repeats or a missed cadence.",
        "Critic gate: Social Content Reviewer signs the recap before it is treated as the day's record.",
        memory(),
      ],
      "shared/deliverables/x-daily-recap.md (what shipped, what held, one learning)",
    ),
  ]),

  "newsletter-empire": missionDoc([
    windowBlock(
      "0 9 * * 1",
      [
        wake([USER, "VOICE.md"]),
        "Use twitter-oauth and linkedin-api via Topic Researcher for this week's issue angles.",
        "Delegate a draft skeleton to Draft Writer (convertkit-newsletter) and a growth/monetization note to Growth Strategist and Monetization Optimizer per the canvas.",
        "Critic gate: Editorial Quality Gate checks voice, claims, and sponsor fit before the draft is 'ready to write'.",
        memory(),
      ],
      "shared/deliverables/newsletter-week-plan.md (theme, outline, send-day risks)",
    ),
  ]),

  "podcast-production-studio": missionDoc([
    windowBlock(
      "0 9 * * 1",
      [
        wake([USER, "GUEST_PIPELINE.md"]),
        "Use tavily-search, gmail-ops, google-calendar, and linkedin-api via Guest Researcher & Booker to refresh the pipeline.",
        "Delegate episode structure to Episode Planner per the canvas. Do not invent confirmed guests.",
        "Critic gate: Podcast Quality Gate reviews guest fit and show-bible alignment.",
        memory(),
      ],
      "shared/GUEST_PIPELINE.md updated plus shared/deliverables/podcast-week.md (who to book, which episode is next)",
    ),
  ]),

  "b2b-sales-machine": missionDoc([
    windowBlock(
      "0 8 * * 1-5",
      [
        wake([USER, "ICP.md", "SEQUENCE.md"]),
        "Use tavily-search, apollo-search, and lead-scoring via ICP Researcher, then clay-enrichment via Lead Enricher, only for ICP.md titles and exclusions.",
        "Delegate sequence copy to Sequence Writer (instantly-email, cold-email-writing, can-spam) and CRM moves to Pipeline Manager per the canvas. Reply Handler only for threads that already exist.",
        "CAN-SPAM: physical address, honest subject, working unsubscribe. No fabricated case studies. No send if USER.md compliance forbids the claim.",
        "Critic gate: Outbound Quality Gate (can-spam) must approve before a sequence is treated as ready to send.",
        memory(),
      ],
      "shared/deliverables/sales-morning-brief.md (new leads, replies, pipeline changes, items blocked by compliance)",
    ),
  ]),

  "agency-operations-os": missionDoc([
    windowBlock(
      "30 8 * * 1-5",
      [
        wake([USER, "CAPACITY.md"]),
        "Use linear-pm / asana-pm / clickup-pm via Resource Allocator and Task Manager to list due work and utilization vs USER.md floor.",
        "Delegate intake gaps to Intake & Scoping (project-scoping, gmail-ops) and a client-safe status to Client Reporter (slack-messaging, gmail-ops) per the canvas.",
        "Critic gate: Agency Quality Gate blocks status that hides scope creep or margin-floor breaches.",
        memory(),
      ],
      "shared/deliverables/agency-daily-brief.md (utilization, due tasks, scope alerts)",
    ),
  ]),

  "founders-chief-of-staff": missionDoc([
    windowBlock(
      "0 7 * * 1-5",
      [
        wake([USER, "ACTION_LOG.md"]),
        "Use gmail-ops, google-calendar, tavily-search, and slack-messaging via Briefing Compiler for the morning packet in USER.md briefing shape.",
        "Delegate meeting context to Meeting Prep Agent and overdue yeses to Action Tracker (linear-pm, asana-pm, google-calendar) per the canvas. Communication Drafter only for items not on the off-limits list.",
        "Critic gate: Executive Quality Gate strips VIP-mute violations and unapproved outbound.",
        memory(),
      ],
      "shared/ACTION_LOG.md updated plus shared/deliverables/cos-morning-brief.md",
    ),
  ]),

  "seo-empire-builder": missionDoc([
    windowBlock(
      "0 9 * * 1-5",
      [
        wake([USER, "CONTENT_CAL.md"]),
        "Use google-search-console, ahrefs-seo, and tavily-search via Keyword Strategist and Rank Tracker for target-term movement.",
        "Delegate a draft brief to Content Writer (seo-content-writing) and a crawl note to Technical SEO Monitor (google-search-console, google-analytics) per the canvas. YMYL topics stay in the human-review pile.",
        "Critic gate: SEO Quality Gate rejects thin pages and unreviewed YMYL.",
        memory(),
      ],
      "shared/CONTENT_CAL.md plus shared/deliverables/seo-weekday-brief.md (ranks, next URL, technical flags)",
    ),
  ]),

  "real-estate-agent-os": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER, "MARKET.md", "LISTINGS.md"]),
        "Use fair-housing, gmail-ops, and lead-scoring via Lead Qualifier for overnight leads. Speed-to-lead follows USER.md.",
        "Delegate market notes to Market Intel (fair-housing, tavily-search) and showing slots to Showing Coordinator (google-calendar) per the canvas.",
        "Fair Housing: no familial, racial, or religious coded phrases. No steering. Facts about the listing only.",
        "Critic gate: Real Estate Quality Gate instantly rejects Fair Housing violations.",
        memory(),
      ],
      "shared/deliverables/re-morning-brief.md (new leads, briefing, showings to confirm)",
    ),
    windowBlock(
      "0 18 * * *",
      [
        wake([USER, "LISTINGS.md"]),
        "Use fair-housing and gmail-ops via Client Communicator to summarize today's tours without inventing feedback.",
        "Queue tomorrow's showings on google-calendar via Showing Coordinator per the canvas.",
        "Critic gate: Real Estate Quality Gate reviews every outbound line.",
        memory(),
      ],
      "shared/deliverables/re-evening-wrap.md (activity, tomorrow queue)",
    ),
    windowBlock(
      "0 9 * * 1",
      [
        wake([USER, "MARKET.md", "LISTINGS.md"]),
        "Use fair-housing and tavily-search via Market Intel for a weekly farm update. Keep inventory facts tied to LISTINGS.md.",
        "Critic gate: Real Estate Quality Gate.",
        memory(),
      ],
      "shared/MARKET.md weekly section plus shared/deliverables/re-weekly-pipeline.md",
    ),
    windowBlock(
      "0 9 1 * *",
      [
        wake([USER, "MARKET.md", "LISTINGS.md"]),
        "Compile a monthly performance note from logged showings and lead sources. No demographic inferences.",
        "Critic gate: Real Estate Quality Gate.",
        memory(),
      ],
      "shared/deliverables/re-monthly-performance.md",
    ),
  ]),

  "recruiter-os": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER]),
        "Use linkedin-api and tavily-search via Sourcer for roles on the USER.md desk. Skip must-not-poach employers.",
        "Delegate screens to Screening Agent and interview holds to Interview Coordinator (google-calendar, gmail-ops) per the canvas.",
        "No age proxies, no 'culture fit' without behavioral evidence, no gap-penalty without context.",
        "Critic gate: Recruiting Quality Gate.",
        memory(),
      ],
      "shared/deliverables/recruiting-morning-pipeline.md",
    ),
    windowBlock(
      "0 17 * * *",
      [
        wake([USER]),
        "Use gmail-ops via Client Reporter to summarize interviews and feedback that actually happened.",
        "Critic gate: Recruiting Quality Gate.",
        memory(),
      ],
      "shared/deliverables/recruiting-evening-feedback.md",
    ),
    windowBlock(
      "0 10 * * 3",
      [
        wake([USER]),
        "Mid-week pipeline health: open reqs, stale candidates, missing screens. Sourcer only if a req is empty.",
        "Critic gate: Recruiting Quality Gate.",
        memory(),
      ],
      "shared/deliverables/recruiting-midweek-health.md",
    ),
    windowBlock(
      "0 16 * * 5",
      [
        wake([USER]),
        "Use gmail-ops via Client Reporter for the weekly client packet. Facts only.",
        "Critic gate: Recruiting Quality Gate.",
        memory(),
      ],
      "shared/deliverables/recruiting-weekly-client-report.md",
    ),
  ]),

  "medical-practice-manager": missionDoc([
    windowBlock(
      "0 7 * * *",
      [
        wake([USER]),
        "Use hipaa-compliance, twilio-sms, and google-calendar via Appointment Manager to build today's roster and send reminders.",
        "Reminders: name, date, time, location only. Never visit reason, procedure, meds, or any other PHI. When unsure, do not send.",
        "Delegate new-patient form gaps to Patient Intake Agent (hipaa-compliance, twilio-sms) per the canvas. No clinical advice.",
        "Critic gate: Healthcare Communication Gate instantly rejects PHI beyond appointment basics.",
        memory(),
      ],
      "shared/deliverables/clinic-morning-roster.md (rooms, reminder send/hold counts, no clinical detail)",
    ),
    windowBlock(
      "0 18 * * *",
      [
        wake([USER]),
        "Use hipaa-compliance via Recall & Reactivation Agent to list recall candidates. Include someone only when a consent note is on file and they have not opted out.",
        "Do not draft voicemails with clinical detail. SMS/email copy stays non-clinical.",
        "Critic gate: Healthcare Communication Gate. Never confirm a visit in a review reply.",
        memory(),
      ],
      "shared/deliverables/clinic-evening-recall-candidates.md (eligible vs skipped-for-consent)",
    ),
    windowBlock(
      "0 8 * * 1",
      [
        wake([USER]),
        "Launch the weekly recall campaign only for the consent-checked list from the evening file. Use hipaa-compliance and twilio-sms via Recall & Reactivation Agent.",
        "Skip anyone without a consent note. No visit-reason language.",
        "Critic gate: Healthcare Communication Gate.",
        memory(),
      ],
      "shared/deliverables/clinic-weekly-recall-campaign.md (sent, skipped, holds)",
    ),
    windowBlock(
      "0 9 15 * *",
      [
        wake([USER]),
        "Use hipaa-compliance via Review & Reputation Manager for a monthly reputation note. Never reference a specific patient visit or treatment in a public reply.",
        "Critic gate: Healthcare Communication Gate.",
        memory(),
      ],
      "shared/deliverables/clinic-monthly-reputation.md",
    ),
  ]),

  "law-firm-intake-os": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER]),
        "Use legal-communication, emergency-triage, and gmail-ops via First Contact Agent to sort overnight inquiries. This is intake only and does not constitute legal advice.",
        "If an inquiry looks like an emergency, notify the human within 15 minutes per emergency-triage. Do not tell the person what to do legally.",
        "Delegate completeness checks to Case Qualifier and conflict hits to Conflict Checker per the canvas.",
        "Critic gate: Legal Communication Gate instantly rejects advice, outcome predictions, and privilege-risk language.",
        memory(),
      ],
      "shared/deliverables/law-morning-intake.md (sorted inquiries, emergencies escalated, conflicts to confirm)",
    ),
    windowBlock(
      "0 18 * * *",
      [
        wake([USER]),
        "Summarize today's intakes and pending follow-ups. Use gmail-ops and google-calendar via Consultation Scheduler only for complete, conflict-cleared matters.",
        "Never advise. Never predict outcomes.",
        "Critic gate: Legal Communication Gate.",
        memory(),
      ],
      "shared/deliverables/law-evening-followups.md",
    ),
    windowBlock(
      "0 9 * * 1",
      [
        wake([USER]),
        "Weekly intake pipeline: referred-out vs taken, aging incomplete intakes, conflict backlog. Facts only.",
        "Critic gate: Legal Communication Gate.",
        memory(),
      ],
      "shared/deliverables/law-weekly-pipeline.md",
    ),
    windowBlock(
      "0 9 1 * *",
      [
        wake([USER]),
        "Monthly conversion note from logged intakes. No case-outcome commentary.",
        "Critic gate: Legal Communication Gate.",
        memory(),
      ],
      "shared/deliverables/law-monthly-conversion.md",
    ),
  ]),

  "home-services-dispatcher": missionDoc([
    windowBlock(
      "0 7 * * *",
      [
        wake([USER]),
        "Use emergency-triage, twilio-sms, and google-calendar via Dispatch Coordinator to build today's board and route sheets.",
        "Safety emergencies go to 911 first. No price quotes. No diagnosis without a tech visit. No promises USER.md forbids.",
        "Delegate overnight calls to Call Handler (emergency-triage, twilio-sms) per the canvas.",
        "Critic gate: Service Communication Gate instantly rejects missing-911, unauthorized quotes, and armchair diagnosis.",
        memory(),
      ],
      "shared/deliverables/dispatch-morning-board.md",
    ),
    windowBlock(
      "0 18 * * *",
      [
        wake([USER]),
        "Use emergency-triage and twilio-sms via Customer Follow-up Agent for completed-job check-ins. No DIY repair advice.",
        "Queue tomorrow's follow-ups only.",
        "Critic gate: Service Communication Gate.",
        memory(),
      ],
      "shared/deliverables/dispatch-evening-wrap.md",
    ),
    windowBlock(
      "0 8 * * 1",
      [
        wake([USER]),
        "Weekly volume and satisfaction note from logged jobs. No invented ratings.",
        "Critic gate: Service Communication Gate.",
        memory(),
      ],
      "shared/deliverables/dispatch-weekly-ops.md",
    ),
    windowBlock(
      "0 9 1 * *",
      [
        wake([USER]),
        "Monthly revenue and review performance from logged jobs. Still no unauthorized quotes.",
        "Critic gate: Service Communication Gate.",
        memory(),
      ],
      "shared/deliverables/dispatch-monthly-performance.md",
    ),
  ]),

  "health-fitness-commander": missionDoc([
    windowBlock(
      "0 6 * * *",
      [
        wake([USER, "PROGRAM.md", "LOG.md"]),
        "Use google-calendar via Workout Planner for today's session that matches USER.md equipment, injuries, and doctor-clearance notes.",
        "Delegate the meal outline to Nutrition Advisor per the canvas. Never program without confirmed doctor approval when USER.md lists a medical condition. Never ignore logged pain.",
        "Calorie floors stay above 1,200 (women) / 1,500 (men) unless a clinician wrote otherwise in USER.md.",
        "Critic gate: Health Quality Gate instantly rejects missing clearance, no-rest-day weeks, and unsafe calorie targets.",
        memory(),
      ],
      "shared/PROGRAM.md today's block plus shared/deliverables/fitness-morning-plan.md",
    ),
    windowBlock(
      "0 20 * * *",
      [
        wake([USER, "LOG.md"]),
        "Use google-calendar via Habit & Recovery Tracker to prompt a log of workout, meals, and sleep that USER.md said they will actually record.",
        "If pain was reported, flag Workout Planner to modify tomorrow. Do not diagnose.",
        "Critic gate: Health Quality Gate.",
        memory(),
      ],
      "shared/LOG.md plus shared/deliverables/fitness-evening-checkin.md",
    ),
    windowBlock(
      "0 19 * * 0",
      [
        wake([USER, "PROGRAM.md", "LOG.md"]),
        "Weekly review: adherence, soreness trends, next week's plan. Keep a rest day. No medical advice.",
        "Critic gate: Health Quality Gate.",
        memory(),
      ],
      "shared/PROGRAM.md next-week section plus shared/deliverables/fitness-weekly-review.md",
    ),
  ]),

  "student-accelerator": missionDoc([
    windowBlock(
      "0 7 * * *",
      [
        wake([USER]),
        "Use academic-integrity, google-calendar, and notion-docs via Study Planner for today's plan from USER.md courses and deadlines.",
        "Delegate a source list to Research Assistant (academic-integrity, tavily-search) per the canvas. Exam Prep Coach only if an exam is inside the deadline window.",
        "No ghostwriting. Citation style from USER.md. What counts as cheating in that program is a hard stop.",
        "Critic gate: Academic Integrity Gate.",
        memory(),
      ],
      "shared/deliverables/study-morning-plan.md",
    ),
    windowBlock(
      "0 21 * * *",
      [
        wake([USER]),
        "Evening review of what was actually covered. Queue tomorrow. Do not complete the student's assignment.",
        "Critic gate: Academic Integrity Gate.",
        memory(),
      ],
      "shared/deliverables/study-evening-review.md",
    ),
    windowBlock(
      "0 18 * * 0",
      [
        wake([USER]),
        "Weekly progress across subjects and next week's calendar holds (google-calendar, notion-docs).",
        "Critic gate: Academic Integrity Gate.",
        memory(),
      ],
      "shared/deliverables/study-weekly-review.md",
    ),
  ]),

  "job-hunter-os": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER]),
        "Use tavily-search and linkedin-api via Opportunity Scout for roles that match USER.md titles, geos, and deal-breakers.",
        "Delegate a tailored draft to Application Crafter (gmail-ops) per the canvas. Do not submit without the human.",
        "Critic gate: Job Search Quality Gate (interview-preparation, salary-negotiation) checks story fit and floor.",
        memory(),
      ],
      "shared/deliverables/jobhunt-morning-digest.md",
    ),
    windowBlock(
      "0 18 * * *",
      [
        wake([USER]),
        "Pipeline status: applications waiting, interviews to prep (interview-preparation), offers touching the floor (salary-negotiation).",
        "Critic gate: Job Search Quality Gate.",
        memory(),
      ],
      "shared/deliverables/jobhunt-evening-pipeline.md",
    ),
    windowBlock(
      "0 9 * * 1",
      [
        wake([USER]),
        "Weekly metrics and strategy: response rate, stale apps, whether the target list drifted.",
        "Critic gate: Job Search Quality Gate.",
        memory(),
      ],
      "shared/deliverables/jobhunt-weekly-review.md",
    ),
  ]),

  "developer-productivity-os": missionDoc([
    windowBlock(
      "0 8 * * *",
      [
        wake([USER]),
        "Use github-ops via PR Reviewer, Issue Triager (github-ops, linear-pm, jira-pm), and Security Scanner for the overnight digest. Stay out of USER.md off-limits repos.",
        "Delegate a doc stub to Doc Generator (github-ops, notion-docs) only when a merged PR lacks notes.",
        "Critic gate: Code Quality Gate (code-review-framework).",
        memory(),
      ],
      "shared/deliverables/dev-morning-digest.md (PRs, issues, alerts)",
    ),
    windowBlock(
      "45 8 * * *",
      [
        wake([USER]),
        "Use github-ops and slack-messaging via Standup Writer to draft standup from the morning digest. Human edits before send.",
        "Critic gate: Code Quality Gate.",
        memory(),
      ],
      "shared/deliverables/dev-standup-draft.md",
    ),
    windowBlock(
      "0 17 * * *",
      [
        wake([USER]),
        "EOD: PRs merged, issues closed, docs updated. github-ops only. No secret scanning output pasted into chat.",
        "Critic gate: Code Quality Gate.",
        memory(),
      ],
      "shared/deliverables/dev-eod-summary.md",
    ),
    windowBlock(
      "0 16 * * 5",
      [
        wake([USER]),
        "Weekly velocity, review turnaround, and debt trends from github-ops. Facts the repo actually has.",
        "Critic gate: Code Quality Gate.",
        memory(),
      ],
      "shared/deliverables/dev-weekly-metrics.md",
    ),
  ]),
}

export const TEMPLATE_SPEC_CRONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(TEMPLATE_MISSION_SCRIPTS).map(([slug, md]) => {
    const crons = [...md.matchAll(/^## window[ \t]+(.+?)\s*$/gm)].map((m) => m[1]!.trim())
    return [slug, crons]
  }),
)

for (const slug of FORMERLY_EMPTY_TEMPLATE_SLUGS) {
  if (!TEMPLATE_MISSION_SCRIPTS[slug]) {
    throw new Error(`INFRA-4: missing mission script for formerly-empty ${slug}`)
  }
}

export function applyMissionScripts(template: SeedTemplate): SeedTemplate {
  const md = TEMPLATE_MISSION_SCRIPTS[template.slug]
  if (!md) {
    throw new Error(`INFRA-4: missing mission script for template ${template.slug}`)
  }
  const orch = template.agents.find((a) => a.role === "ORCHESTRATOR")
  if (!orch) {
    throw new Error(`INFRA-4: no orchestrator on ${template.slug}`)
  }
  return {
    ...template,
    agents: template.agents.map((agent) =>
      agent.role === "ORCHESTRATOR" ? { ...agent, heartbeatMd: md } : agent,
    ),
  }
}
