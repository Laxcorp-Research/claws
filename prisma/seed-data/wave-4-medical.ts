import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  MEDICAL_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const MEDICAL_WAVE4_SLUG = "medical-practice-manager"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const RECALL = `${SHARED}/RECALL.md`
const REMINDERS = `${SHARED}/REMINDERS.md`
const DIMS = MEDICAL_CRITIC_SCORE_DIMENSIONS.join(" / ")

const REMINDER_FORMAT = `Reminder format (only these fields):
1. Patient preferred name (or 'Patient' if unset)
2. Date
3. Time
4. Location / practice name
Never: visit reason, procedure, diagnosis, meds, test results, or any other clinical detail.`

const CONSENT_RECALL = `Consent-gated recall lists:
- Include someone only when ${RECALL} has consent=yes and optOut=no.
- Skip anyone without a consent note. Write skipped-for-consent, do not invent consent.
- Campaign send is an ACTION card.`

const PHI_REJECT_FIXTURE =
  'PHI reject fixture: "Reminder: your root canal on Tuesday at 2pm" MUST REJECT. Visit reason is PHI.'

export const MEDICAL_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 7 * * *
1. Wake. Read ${USER}, ${REMINDERS}. If interview is incomplete, skip and say so.
2. Delegate Appointment Manager: today's roster. ${REMINDER_FORMAT}
3. ${PHI_REJECT_FIXTURE}
4. Failure: twilio down → draft reminders as ACTION. Do not send.
5. Write clinic-morning-roster.md (no clinical detail). Paste verbatim.

## window 0 18 * * *
1. Wake. Read ${RECALL}.
2. Delegate Recall & Reactivation Agent: ${CONSENT_RECALL}
3. Critic: HIPAA. Write clinic-evening-recall-candidates.md (eligible vs skipped-for-consent).

## window 0 8 * * 1
1. Launch weekly recall only for consent=yes rows. Twilio send is ACTION.
2. Write clinic-weekly-recall-campaign.md.

## window 0 9 15 * *
1. Reputation note. Never confirm a visit in a public reply.
2. Write clinic-monthly-reputation.md.
`

export const MEDICAL_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Appointment Manager: one reminder in reminder format (name/date/time/location only).
2. Recall & Reactivation Agent: one consent-gated recall list. Skip anyone without consent=yes.
3. Healthcare Communication Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only. ${PHI_REJECT_FIXTURE}
4. Present the surviving reminder plus the critic table in chat. Recall SMS send is an ACTION card. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/RECALL.md",
    title: "RECALL.md",
    maintainedBy: "recall-reactivation-agent",
    schema: ["rowId", "consent: yes | no | unknown", "optOut: yes | no", "channel", "lastContact"],
    format: CONSENT_RECALL,
    example: "| R-12 | yes | no | sms | 2026-06-01 |",
    entries: "_No recall rows. Unknown consent is skip, not send._",
  }),
  wave4NamedFile({
    path: "shared/REMINDERS.md",
    title: "REMINDERS.md",
    maintainedBy: "appointment-manager",
    schema: ["name", "date", "time", "location", "status: drafted | held | sent-ACTION"],
    format: REMINDER_FORMAT,
    example: "| Alex | 2026-09-10 | 14:00 | Main clinic | drafted |",
    entries: "_No reminders yet. Never store a visit reason in this file._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/reminder-draft.md",
    title: "reminder-draft.md",
    maintainedBy: "appointment-manager",
    schema: ["fields", "claims-table", "action"],
    format: `${REMINDER_FORMAT}\n${PHI_REJECT_FIXTURE}`,
    example: "Alex, 10 Sep 2026, 2:00pm, Main clinic. Send is ACTION.",
    entries: "_Empty until the first reminder._",
  }),
]

const ADDENDA = {
  "practice-commander": {
    soulMd: `# WAVE-4 operations

${REMINDER_FORMAT}
${CONSENT_RECALL}
${PHI_REJECT_FIXTURE}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission. Recall SMS is ACTION.

# Never

- Never include visit reason in a reminder.
- Never invent consent.
`,
  },
  "patient-intake-agent": {
    soulMd: `# WAVE-4 intake

Forms collect demographics the practice already stores in the EHR. Do not echo clinical detail into chat or ${REMINDERS}.
`,
  },
  "appointment-manager": {
    soulMd: `# WAVE-4 reminders

${REMINDER_FORMAT}
${PHI_REJECT_FIXTURE}
Write ${REMINDERS}. Twilio send is ACTION.
`,
  },
  "recall-reactivation-agent": {
    soulMd: `# WAVE-4 recall

${CONSENT_RECALL}
Write ${RECALL}. Campaign send is ACTION.
`,
  },
  "review-reputation-manager": {
    soulMd: `# WAVE-4 reviews

Never confirm a patient visited. Invite them to call the office. No visit or treatment in the public reply.
`,
  },
  "healthcare-communication-gate": {
    soulMd: `# WAVE-4 critic law

Dimensions: ${DIMS}.
${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`.
${STRICT_8_DEFINITION}
${PHI_REJECT_FIXTURE}

neverApprove:
- PHI beyond appointment basics
- reminder with visit reason or procedure
- recall row with consent unknown or no
- review reply that confirms a visit

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| hipaa | n | ... |
| reminder-scope | n | ... |
| consent | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave4Medical(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: MEDICAL_WAVE4_SLUG,
    addenda: ADDENDA,
    heartbeatMd: MEDICAL_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
