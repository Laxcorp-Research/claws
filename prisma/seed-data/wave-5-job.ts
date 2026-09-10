import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  JOB_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const JOB_WAVE5_SLUG = "job-hunter-os"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const TARGETS = `${SHARED}/TARGETS.md`
const APPLICATIONS = `${SHARED}/APPLICATIONS.md`
const DIMS = JOB_CRITIC_SCORE_DIMENSIONS.join(" / ")

export const ATS_RESUME_FORMAT = `ATS-tailored resume format:
1. Target title from ${TARGETS} (file:line)
2. Exact posting keywords that also appear in USER.md story (no invented titles)
3. Reverse-chron bullets: action + artifact + result. No first-person claims without a source.
4. Plain text that survives ATS: no tables, no headers as images.`

export const STAR_PREP_FORMAT = `STAR prep:
1. Situation from USER.md or ${APPLICATIONS} (file:line)
2. Task
3. Action the human actually took
4. Result with a number only if a source exists
Invented metrics are REJECT.`

export const NEGOTIATION_SCRIPT = `Negotiation script:
1. Total-comp breakdown
2. Market range with a tool id
3. Collaborative ask (not an ultimatum)
4. Walk-away from USER.md ### floor
Never bluff a competing offer that is not in ${APPLICATIONS}.`

export const JOB_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 8 * * *
1. Wake. Read ${USER}, ${TARGETS}, ${APPLICATIONS}.
2. Opportunity Scout: roles that match titles, geos, deal-breakers.
3. Application Crafter: ATS-tailored resume + cover in the ATS format. Do not send.
4. Application submit via gmail is ACTION. Write jobhunt-morning-digest.md.

## window 0 18 * * *
1. Pipeline: waiting, interviews (STAR prep), offers (negotiation script).
2. Write jobhunt-evening-pipeline.md.

## window 0 9 * * 1
1. Weekly response rate and target drift from ${TARGETS}.
2. Write jobhunt-weekly-review.md.
`

export const JOB_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Opportunity Scout: one fixture role into ${TARGETS}.
2. Application Crafter: ATS-tailored resume format. Interview Coach: one STAR. Negotiation Advisor: script against the floor.
3. Job Search Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Present the surviving pack plus the critic table in chat. Application submit via gmail is an ACTION card. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/TARGETS.md",
    title: "TARGETS.md",
    maintainedBy: "opportunity-scout",
    schema: ["company", "title", "geo-or-remote", "source: tool id", "fit-note"],
    format: "Only roles that match USER.md titles and deal-breakers.",
    example: "| Acme | Staff Engineer | remote | tool:tavily:r4 | matches staff + remote |",
    entries: "_No targets yet. Opportunity Scout writes after interview._",
  }),
  wave4NamedFile({
    path: "shared/APPLICATIONS.md",
    title: "APPLICATIONS.md",
    maintainedBy: "application-crafter",
    schema: ["id", "company", "status: drafted | ACTION-submit | waiting | interview | offer", "gmail-draft"],
    format: "Submit is ACTION. Never mark sent without approval.",
    example: "| A-1 | Acme | ACTION-submit | gmail draft id fixture |",
    entries: "_No applications yet._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/application-pack.md",
    title: "application-pack.md",
    maintainedBy: "application-crafter",
    schema: ["ats-resume", "star", "negotiation-script", "claims-table", "action"],
    format: `${ATS_RESUME_FORMAT}\n${STAR_PREP_FORMAT}\n${NEGOTIATION_SCRIPT}\nACTION = application submit via gmail fixture.`,
    example: "Acme Staff resume drafted. STAR: shipped X from USER.md:12. Submit gmail ACTION.",
    entries: "_Empty until the first pack._",
  }),
]

const ADDENDA = {
  "job-hunt-commander": {
    soulMd: `# WAVE-5 operations

You are Job Hunt Commander. ${ATS_RESUME_FORMAT}
${STAR_PREP_FORMAT}
${NEGOTIATION_SCRIPT}
Application submit via gmail is ACTION.

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission.
`,
  },
  "opportunity-scout": {
    soulMd: `# WAVE-5 scout

Write ${TARGETS}. Titles, geos, deal-breakers from ${USER}. Tool id on every row.
`,
  },
  "application-crafter": {
    soulMd: `# WAVE-5 applications

${ATS_RESUME_FORMAT}
Write ${APPLICATIONS}. Application submit via gmail is ACTION. Never send.
`,
  },
  "interview-coach": {
    soulMd: `# WAVE-5 STAR

${STAR_PREP_FORMAT}
Invented metrics REJECT.
`,
  },
  "negotiation-advisor": {
    soulMd: `# WAVE-5 negotiation

${NEGOTIATION_SCRIPT}
`,
  },
  "job-search-quality-gate": {
    soulMd: `# WAVE-5 critic

neverApprove: invented titles, bluffed competing offers, gmail already-sent, unsourced STAR numbers.

${CLAIMS_TABLE_STEP_MARKER}. ${STRICT_8_DEFINITION}

${CRITIC_DIMENSION_TABLE_HEADER}
| ats-fit | n | ... |
| star-truth | n | ... |
| negotiation-integrity | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave5Job(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: JOB_WAVE5_SLUG,
    addenda: ADDENDA,
    heartbeatMd: JOB_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
