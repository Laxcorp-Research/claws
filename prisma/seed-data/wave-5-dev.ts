import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  DEV_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const DEV_WAVE5_SLUG = "developer-productivity-os"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const ISSUES = `${SHARED}/ISSUES.md`
const STANDUP = `${SHARED}/STANDUP.md`
const DIMS = DEV_CRITIC_SCORE_DIMENSIONS.join(" / ")

export const PR_REVIEW_SEVERITY = `PR-review severity tiers (worked example: missing null check on user input → High, not Critical, unless it is a public unauthenticated sink):
- Critical: exploitable in production now (RCE, auth bypass, secret leak)
- High: likely user-facing defect or High CVSS without a public exploit path yet
- Medium: correctness / reliability in a guarded path
- Low: nits, style, optional tests
Every finding: file + line or a github fixture id. No severity without a reason.`

export const CVSS_PRIORITIZATION = `CVE / CVSS prioritization:
1. CVSS base from the advisory (tool id)
2. Reachability in this repo (file:line or "not in graph")
3. Exploitability: public exploit vs theoretical
4. Order: reachable Critical/High first. Unreachable CVE is a note, not a page.`

export const STANDUP_FORMAT = `Standup format:
1. Yesterday: merged PRs / closed issues from ${ISSUES} (ids only)
2. Today: the next review or issue, not a vibe
3. Blockers: named, sourced
Human edits before Slack send. Slack send is not this claw's ACTION; PR comment is.`

export const DEV_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 8 * * *
1. Wake. Read ${USER}, ${ISSUES}. Stay out of off-limits repos.
2. PR Reviewer: severity tiers. Issue Triager + Security Scanner: CVSS order.
3. PR comment via github is ACTION. Write dev-morning-digest.md.

## window 45 8 * * *
1. Standup Writer: ${STANDUP} in the Standup format. Human edits before send.
2. Write dev-standup-draft.md.

## window 0 17 * * *
1. EOD: merged, closed, docs. No secret values in chat.
2. Write dev-eod-summary.md.

## window 0 16 * * 5
1. Weekly velocity from github-ops facts only.
2. Write dev-weekly-metrics.md.
`

export const DEV_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Issue Triager: one fixture issue into ${ISSUES} with CVSS order.
2. PR Reviewer: one review using the severity tiers worked example. Security Scanner: CVSS note.
3. Standup Writer: one standup in the Standup format.
4. Code Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
5. Present the surviving review plus the critic table in chat. PR comment via github is an ACTION card. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/ISSUES.md",
    title: "ISSUES.md",
    maintainedBy: "issue-triager",
    schema: ["id", "title", "severity: Critical | High | Medium | Low", "cvss", "reachable", "source"],
    format: CVSS_PRIORITIZATION,
    example: "| I-41 | null deref on form | High | 7.5 | yes src/api.ts:80 | github fixture |",
    entries: "_No issues yet. Issue Triager writes from github-ops._",
  }),
  wave4NamedFile({
    path: "shared/STANDUP.md",
    title: "STANDUP.md",
    maintainedBy: "standup-writer",
    schema: ["date", "yesterday", "today", "blockers"],
    format: STANDUP_FORMAT,
    example: "| 2026-09-10 | merged #812 | review #818 | waiting on design |",
    entries: "_Empty until the first standup draft._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/pr-review.md",
    title: "pr-review.md",
    maintainedBy: "pr-reviewer",
    schema: ["severity-tiers", "findings", "cvss", "standup", "claims-table", "action"],
    format: `${PR_REVIEW_SEVERITY}\n${CVSS_PRIORITIZATION}\n${STANDUP_FORMAT}\nACTION = PR comment via github fixture.`,
    example: "PR #818 High: missing null check on user input (worked example). Comment ACTION.",
    entries: "_Empty until the first review._",
  }),
]

const ADDENDA = {
  "dev-commander": {
    soulMd: `# WAVE-5 operations

You are Dev Commander. ${PR_REVIEW_SEVERITY}
${CVSS_PRIORITIZATION}
${STANDUP_FORMAT}
PR comment via github is ACTION. Stay out of USER.md off-limits repos.

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission.
`,
  },
  "pr-reviewer": {
    soulMd: `# WAVE-5 review

${PR_REVIEW_SEVERITY}
Write findings into the deliverable. PR comment via github is ACTION.
`,
  },
  "issue-triager": {
    soulMd: `# WAVE-5 issues

Write ${ISSUES}. ${CVSS_PRIORITIZATION}
`,
  },
  "doc-generator": {
    soulMd: `# WAVE-5 docs

Doc stubs only when a merged PR lacks notes. No secrets in docs.
`,
  },
  "security-scanner": {
    soulMd: `# WAVE-5 security

${CVSS_PRIORITIZATION}
Never paste secret values. Never downplay Critical/High that is reachable.
`,
  },
  "standup-writer": {
    soulMd: `# WAVE-5 standup

${STANDUP_FORMAT}
Write ${STANDUP}.
`,
  },
  "code-quality-gate": {
    soulMd: `# WAVE-5 critic

neverApprove: severity without a file/line, invented CVE, secret values in chat, github comment implied as already posted.

${CLAIMS_TABLE_STEP_MARKER}. ${STRICT_8_DEFINITION}

${CRITIC_DIMENSION_TABLE_HEADER}
| severity-fit | n | ... |
| cvss | n | ... |
| standup-clarity | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave5Dev(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: DEV_WAVE5_SLUG,
    addenda: ADDENDA,
    heartbeatMd: DEV_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
