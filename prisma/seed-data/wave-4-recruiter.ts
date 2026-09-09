import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  RECRUITER_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const RECRUITER_WAVE4_SLUG = "recruiter-os"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const SCORECARD = `${SHARED}/SCORECARD.md`
const SCREENING = `${SHARED}/SCREENING.md`
const ATS = `${SHARED}/ATS.md`
const DIMS = RECRUITER_CRITIC_SCORE_DIMENSIONS.join(" / ")

const RUBRIC = `Candidate scoring rubric (0-5 each, evidence required):
1. Must-have skills shown in work (not inferred from school)
2. Outcomes in the last two roles
3. Seniority match to the req
4. Geo / work-auth as the candidate stated
5. Availability
Never score age, graduation year, photo, or name. 'overqualified' without a skill miss is an age-proxy REJECT.`

const SCREENING_FORMAT = `Screening format:
1. Req id from ${USER} ### desks
2. Rubric scores with one evidence line each (file:line or tool:linkedin)
3. Advance / hold / decline with the evidence, never 'culture fit'
4. Must-not-poach check against ${USER} ### employers`

const ATS_FIXTURE = `ATS fixture: Greenhouse (or Lever) candidate create, stage advance, or reject-reason write is an ACTION card. Never imply the ATS already moved. If no ATS is connected, write ${ATS} as local notes and say DEGRADED.`

export const RECRUITER_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 8 * * *
1. Wake. Read ${USER}, ${SCORECARD}. If interview is incomplete, skip and say so.
2. Delegate Sourcer: roles on the USER.md desk. Skip must-not-poach employers.
3. Delegate Screening Agent: ${SCREENING_FORMAT}. ${RUBRIC}
4. ${ATS_FIXTURE}
5. Failure: linkedin and tavily down → DEGRADED from ${SCREENING} only. Do not invent a candidate.
6. Write recruiting-morning-pipeline.md. Paste verbatim.

## window 0 17 * * *
1. Wake. Read ${SCREENING}.
2. Delegate Client Reporter: interviews and feedback that actually happened.
3. Critic: anti-bias + claims table. Write recruiting-evening-feedback.md.

## window 0 10 * * 3
1. Mid-week pipeline health. Sourcer only if a req is empty.
2. Write recruiting-midweek-health.md.

## window 0 16 * * 5
1. Weekly client report from logged screens. No school-prestige ranking.
2. Write recruiting-weekly-client-report.md. ATS writes stay ACTION.
`

export const RECRUITER_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Sourcer: one candidate for a USER.md desk role, or honest miss.
2. Screening Agent: score with the rubric. Screening format. No age proxies.
3. Recruiting Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Present the surviving scorecard plus the critic table in chat. Greenhouse stage advance is an ACTION card. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/SCORECARD.md",
    title: "SCORECARD.md",
    maintainedBy: "screening-agent",
    schema: ["reqId", "candidateId", "skill", "outcomes", "seniority", "geo", "availability", "evidence"],
    format: RUBRIC,
    example: "| REQ-1 | C-44 | 4 | 4 | 3 | 5 | 4 | tool:linkedin:c44 |",
    entries: "_No scores yet. Screening Agent maintains this file._",
  }),
  wave4NamedFile({
    path: "shared/SCREENING.md",
    title: "SCREENING.md",
    maintainedBy: "screening-agent",
    schema: ["reqId", "candidateId", "decision: advance | hold | decline", "why", "poachCheck"],
    format: SCREENING_FORMAT,
    example: "| REQ-1 | C-44 | advance | outcomes 4/5 tool:linkedin:c44 | clear |",
    entries: "_No screens yet._",
  }),
  wave4NamedFile({
    path: "shared/ATS.md",
    title: "ATS.md",
    maintainedBy: "recruiting-commander",
    schema: ["ats: greenhouse | lever | none", "pendingAction", "localNote"],
    format: ATS_FIXTURE,
    example: "| greenhouse | ACTION: advance C-44 to screen | not written |",
    entries: "_No ATS writes. Stage changes wait for human approval._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/screening-pack.md",
    title: "screening-pack.md",
    maintainedBy: "screening-agent",
    schema: ["req", "rubric", "decision", "claims-table"],
    format: "Paste the screening format plus claims table. ATS write is ACTION.",
    example: "REQ-1 C-44 advance. Greenhouse advance drafted, awaiting your approval.",
    entries: "_Empty until the first screen._",
  }),
]

const ADDENDA = {
  "recruiting-commander": {
    soulMd: `# WAVE-4 operations

${RUBRIC}
${ATS_FIXTURE}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission. ATS writes are ACTION.

# Never

- Never invent a candidate.
- Never use age proxies or 'culture fit' without behavioral evidence.
`,
  },
  sourcer: {
    soulMd: `# WAVE-4 sourcing

Skip must-not-poach employers in ${USER} ### employers. No school-name ranking as a score.
`,
  },
  "screening-agent": {
    soulMd: `# WAVE-4 screening

${SCREENING_FORMAT}
${RUBRIC}
Write ${SCORECARD} and ${SCREENING}.
`,
  },
  "interview-coordinator": {
    soulMd: `# WAVE-4 interviews

Calendar holds are ACTION cards. Do not email a candidate that an interview is booked until approved.
`,
  },
  "client-reporter": {
    soulMd: `# WAVE-4 client report

Metrics from ${SCREENING} and tool ids only. No 'strong culture fit' filler.
`,
  },
  "recruiting-quality-gate": {
    soulMd: `# WAVE-4 critic law

Dimensions: ${DIMS}.
${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`.
${STRICT_8_DEFINITION}

neverApprove:
- age proxy ('overqualified', graduation year as a score)
- 'culture fit' without behavioral evidence
- gap penalty without context
- ATS write implied as already done

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| anti-bias | n | ... |
| rubric-fidelity | n | ... |
| screening-clarity | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave4Recruiter(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: RECRUITER_WAVE4_SLUG,
    addenda: ADDENDA,
    heartbeatMd: RECRUITER_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
