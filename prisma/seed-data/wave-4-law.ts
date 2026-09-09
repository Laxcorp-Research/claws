import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  LAW_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const LAW_WAVE4_SLUG = "law-firm-intake-os"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const INTAKE = `${SHARED}/INTAKE.md`
const CONFLICTS = `${SHARED}/CONFLICTS.md`
const DIMS = LAW_CRITIC_SCORE_DIMENSIONS.join(" / ")

const QUALIFICATION = `Intake qualification per practice area:
1. Matter type from ${USER} ### matters (take vs refer-out)
2. Jurisdiction from ${USER} ### jurisdiction
3. Completeness: facts they stated, not legal conclusions
4. Refer-out if the area is not taken. Do not advise them where else to file.`

const EMERGENCY_ACTION =
  "Emergency triage: arrest, ICE detention, domestic violence, emergency custody → page the human within 15 minutes as an ACTION card. Do not tell them what to file. Do not predict outcomes."

const CONFLICT_FORMAT = `Conflict-check format:
1. Inquiring party names (as given)
2. Adverse party names (as given)
3. Search ${CONFLICTS} and firm records
4. Result: clear | hit | needs-human
5. Hits halt intake. Attorney review is ACTION.`

const UPL_REJECT_FIXTURE =
  'UPL reject fixture: "You should file for bankruptcy this week" MUST REJECT. That is legal advice.'

export const LAW_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 8 * * *
1. Wake. Read ${USER}, ${INTAKE}, ${CONFLICTS}. If interview is incomplete, skip and say so.
2. Delegate First Contact Agent: overnight inquiries. Intake only. Not legal advice.
3. ${EMERGENCY_ACTION}
4. Delegate Case Qualifier: ${QUALIFICATION}
5. Delegate Conflict Checker: ${CONFLICT_FORMAT}
6. ${UPL_REJECT_FIXTURE}
7. Write law-morning-intake.md. Paste verbatim.

## window 0 18 * * *
1. Summarize intakes. Schedule only complete, conflict-cleared matters. Calendar is ACTION.
2. Write law-evening-followups.md.

## window 0 9 * * 1
1. Weekly intake conversion from logged rows. No outcome predictions.
2. Write law-weekly-pipeline.md.

## window 0 9 1 * *
1. Monthly intake report. Never name other clients.
2. Write law-monthly-conversion.md.
`

export const LAW_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. First Contact Agent: one intake with the standard disclaimer. Not legal advice.
2. Case Qualifier: qualify against USER.md practice areas.
3. Conflict Checker: conflict-check format. Hits halt.
4. Legal Communication Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only. ${UPL_REJECT_FIXTURE}
5. If the fixture is an emergency, the human page within 15 minutes is an ACTION card. Present the surviving intake plus the critic table in chat. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/INTAKE.md",
    title: "INTAKE.md",
    maintainedBy: "case-qualifier",
    schema: ["inquiryId", "practiceArea", "jurisdiction", "complete: yes | no", "emergency: yes | no"],
    format: QUALIFICATION,
    example: "| I-9 | family | CA | yes | no |",
    entries: "_No intakes yet. No legal conclusions in this file._",
  }),
  wave4NamedFile({
    path: "shared/CONFLICTS.md",
    title: "CONFLICTS.md",
    maintainedBy: "conflict-checker",
    schema: ["inquiryId", "party", "adverse", "result: clear | hit | needs-human", "source"],
    format: CONFLICT_FORMAT,
    example: "| I-9 | Rivera | Northside LLC | clear | CONFLICTS.md local |",
    entries: "_No conflict rows. Hits are ACTION for an attorney._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/intake-pack.md",
    title: "intake-pack.md",
    maintainedBy: "intake-commander",
    schema: ["disclaimer", "qualification", "conflict", "claims-table", "action"],
    format: `${QUALIFICATION}\n${EMERGENCY_ACTION}\n${UPL_REJECT_FIXTURE}`,
    example: "Intake I-9 family CA, conflict clear. Consultation booking is ACTION.",
    entries: "_Empty until the first intake._",
  }),
]

const ADDENDA = {
  "intake-commander": {
    soulMd: `# WAVE-4 operations

${QUALIFICATION}
${EMERGENCY_ACTION}
${UPL_REJECT_FIXTURE}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission. Emergency human page is ACTION.

# Never

- Never give legal advice.
- Never predict case outcomes.
`,
  },
  "first-contact-agent": {
    soulMd: `# WAVE-4 first contact

Include the intake-only disclaimer. ${EMERGENCY_ACTION}
${UPL_REJECT_FIXTURE}
`,
  },
  "case-qualifier": {
    soulMd: `# WAVE-4 qualification

${QUALIFICATION}
Write ${INTAKE}. Refer-out is a fact about the firm's list, not advice.
`,
  },
  "conflict-checker": {
    soulMd: `# WAVE-4 conflicts

${CONFLICT_FORMAT}
Write ${CONFLICTS}. Hits halt. Attorney review is ACTION.
`,
  },
  "consultation-scheduler": {
    soulMd: `# WAVE-4 scheduling

Only after complete + conflict clear. Calendar create is ACTION. Scheduling does not create an attorney-client relationship.
`,
  },
  "legal-communication-gate": {
    soulMd: `# WAVE-4 critic law

Dimensions: ${DIMS}.
${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`.
${STRICT_8_DEFINITION}
${UPL_REJECT_FIXTURE}

neverApprove:
- legal advice or 'you should file'
- outcome prediction
- missing 15-minute emergency ACTION
- conflict hit that still proceeds

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| zero-advice | n | ... |
| conflict-check | n | ... |
| emergency-triage | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave4Law(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: LAW_WAVE4_SLUG,
    addenda: ADDENDA,
    heartbeatMd: LAW_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
