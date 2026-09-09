import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  HOME_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const HOME_WAVE4_SLUG = "home-services-dispatcher"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const TRIAGE = `${SHARED}/TRIAGE.md`
const DISPATCH = `${SHARED}/DISPATCH.md`
const DIMS = HOME_CRITIC_SCORE_DIMENSIONS.join(" / ")

const TRIAGE_TREE = `Emergency triage tree (run first, before any dispatch):
1. Gas smell / gas leak → instruct evacuate, call 911. Do NOT dispatch a tech.
2. CO alarm sounding → instruct evacuate, call 911. Do NOT dispatch a tech.
3. Active flooding / no heat in freezing → emergency dispatch, fastest available tech. Still not a diagnosis.
4. All other → standard intake, then dispatch format.
Never skip 911 on gas/CO to 'send a tech first'.`

const DISPATCH_FORMAT = `Dispatch format:
1. Job id
2. Trade + skill tag from ${USER} ### techs
3. Window (not a guaranteed arrival)
4. Tech id or 'unassigned'
5. Safety class: 911 | emergency-dispatch | standard
Calendar / SMS to the tech is ACTION.`

const FOLLOWUP_ACTION =
  "Post-service follow-up and review request are ACTION cards. Never ask a dissatisfied customer for a review. Never invent a diagnosis or an unauthorized price."

export const HOME_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 7 * * *
1. Wake. Read ${USER}, ${TRIAGE}, ${DISPATCH}. If interview is incomplete, skip and say so.
2. Delegate Call Handler: overnight requests through the emergency triage tree.
3. Delegate Dispatch Coordinator: ${DISPATCH_FORMAT}
4. Gas/CO stays evacuate+911. No tech dispatch on those classes.
5. Write home-morning-board.md. Paste verbatim. Tech SMS is ACTION.

## window 0 18 * * *
1. Log completed jobs. Queue follow-ups. ${FOLLOWUP_ACTION}
2. Write home-evening-followups.md.

## window 0 8 * * 1
1. Weekly volume and satisfaction from logged jobs. No invented revenue.
2. Write home-weekly-ops.md.

## window 0 9 1 * *
1. Monthly review performance. Review asks stay ACTION.
2. Write home-monthly-reviews.md.
`

export const HOME_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Call Handler: run the emergency triage tree on one fixture (include a gas/CO case). Evacuate+911 first.
2. Dispatch Coordinator: dispatch format for a non-911 job. No diagnosis. No unauthorized price.
3. Service Communication Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Present the surviving board plus the critic table in chat. Tech dispatch SMS is an ACTION card. Follow-up/review is a separate ACTION. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/TRIAGE.md",
    title: "TRIAGE.md",
    maintainedBy: "call-handler",
    schema: ["jobId", "class: 911 | emergency-dispatch | standard", "symptom-as-stated", "action"],
    format: TRIAGE_TREE,
    example: "| J-1 | 911 | gas smell | evacuate + 911; no tech |",
    entries: "_No triage rows. Gas/CO never become a tech dispatch._",
  }),
  wave4NamedFile({
    path: "shared/DISPATCH.md",
    title: "DISPATCH.md",
    maintainedBy: "dispatch-coordinator",
    schema: ["jobId", "trade", "window", "techId", "safetyClass", "status: drafted | ACTION"],
    format: DISPATCH_FORMAT,
    example: "| J-2 | plumbing | 10:00-12:00 | T-4 | standard | drafted |",
    entries: "_No dispatches. SMS to tech waits for approval._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/dispatch-board.md",
    title: "dispatch-board.md",
    maintainedBy: "dispatch-commander",
    schema: ["triage", "board", "claims-table", "action"],
    format: `${TRIAGE_TREE}\n${DISPATCH_FORMAT}\n${FOLLOWUP_ACTION}`,
    example: "J-1 gas → 911. J-2 plumbing window 10-12 drafted ACTION.",
    entries: "_Empty until the first board._",
  }),
]

const ADDENDA = {
  "dispatch-commander": {
    soulMd: `# WAVE-4 operations

${TRIAGE_TREE}
${DISPATCH_FORMAT}
${FOLLOWUP_ACTION}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission. Tech SMS is ACTION.

# Never

- Never dispatch a tech to gas leak or CO alarm.
- Never quote a price the company did not authorize.
- Never diagnose without a tech visit.
`,
  },
  "call-handler": {
    soulMd: `# WAVE-4 triage

${TRIAGE_TREE}
Write ${TRIAGE}. Gas/CO: evacuate + 911 first.
`,
  },
  "dispatch-coordinator": {
    soulMd: `# WAVE-4 dispatch

${DISPATCH_FORMAT}
Write ${DISPATCH}. Skip any 911-class job. Tech notify is ACTION.
`,
  },
  "customer-follow-up-agent": {
    soulMd: `# WAVE-4 follow-up

${FOLLOWUP_ACTION}
`,
  },
  "service-communication-gate": {
    soulMd: `# WAVE-4 critic law

Dimensions: ${DIMS}.
${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`.
${STRICT_8_DEFINITION}

neverApprove:
- gas/CO without evacuate+911 first
- tech dispatched to a 911-class job
- unauthorized price
- diagnosis without a tech visit
- review ask to a dissatisfied customer

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| safety-first | n | ... |
| dispatch-fit | n | ... |
| follow-up | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave4Home(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: HOME_WAVE4_SLUG,
    addenda: ADDENDA,
    heartbeatMd: HOME_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
