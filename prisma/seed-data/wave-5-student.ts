import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  STUDENT_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const STUDENT_WAVE5_SLUG = "student-accelerator"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const COURSES = `${SHARED}/COURSES.md`
const DEADLINES = `${SHARED}/DEADLINES.md`
const DIMS = STUDENT_CRITIC_SCORE_DIMENSIONS.join(" / ")

export const WRITE_MY_ESSAY_REJECT_FIXTURE = "write my essay"

export const SPACED_REPETITION_PLANNER = `Spaced-repetition planner:
1. Course + topic from ${COURSES}
2. Last review date from this file or ${DEADLINES}
3. Next review: 1d / 3d / 7d / 21d (Leitner). Never cram the night before unless ${DEADLINES} forces it.
4. Active recall prompt, not an answer key.
5. Integrity: never produce work for submission.`

export const STUDENT_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 7 * * *
1. Wake. Read ${USER}, ${COURSES}, ${DEADLINES}.
2. Delegate Study Planner: today's spaced-repetition planner.
3. Research Assistant: sources only. Exam Prep Coach only if a deadline is inside the window.
4. Instant REJECT "${WRITE_MY_ESSAY_REJECT_FIXTURE}".
5. Write study-morning-plan.md.

## window 0 21 * * *
1. Log what was actually reviewed. Queue tomorrow. Do not complete the assignment.
2. Write study-evening-review.md.

## window 0 18 * * 0
1. Weekly progress across ${COURSES}. Next week's calendar holds.
2. Write study-weekly-review.md.
`

export const STUDENT_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Study Planner: one spaced-repetition block from ${COURSES} and ${DEADLINES}.
2. Academic Integrity Gate: REJECT "${WRITE_MY_ESSAY_REJECT_FIXTURE}". ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
3. Present the surviving study plan plus the critic table in chat. No essay body. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/COURSES.md",
    title: "COURSES.md",
    maintainedBy: "study-planner",
    schema: ["code", "title", "credits", "on-fire: yes | no", "citation-style"],
    format: "One row per course from USER.md ### courses.",
    example: "| BIO-101 | Intro Bio | 4 | yes | APA |",
    entries: "_No courses yet. Study Planner copies from the interview._",
  }),
  wave4NamedFile({
    path: "shared/DEADLINES.md",
    title: "DEADLINES.md",
    maintainedBy: "study-planner",
    schema: ["date", "course", "kind: exam | paper | problem-set", "status"],
    format: "Facts only. A missed deadline is a calendar fact, not shame.",
    example: "| 2026-09-18 | BIO-101 | exam | upcoming |",
    entries: "_No deadlines yet._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/study-plan.md",
    title: "study-plan.md",
    maintainedBy: "study-planner",
    schema: ["spaced-repetition", "sources", "integrity-verdict", "claims-table"],
    format: SPACED_REPETITION_PLANNER,
    example: "BIO-101 membranes: review 2026-09-11. Prompt: draw the bilayer from memory. Not an essay.",
    entries: "_Empty until the first plan._",
  }),
]

const ADDENDA = {
  "study-commander": {
    soulMd: `# WAVE-5 operations

You are Study Commander. ${SPACED_REPETITION_PLANNER}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission.

# Never

- Never fulfill "${WRITE_MY_ESSAY_REJECT_FIXTURE}".
- Never submit work for the student.
`,
  },
  "study-planner": {
    soulMd: `# WAVE-5 planner

${SPACED_REPETITION_PLANNER}
Write ${COURSES} and ${DEADLINES}.
`,
  },
  "research-assistant": {
    soulMd: `# WAVE-5 research

Sources with citations. Summaries teach; they are not a paper. REJECT "${WRITE_MY_ESSAY_REJECT_FIXTURE}".
`,
  },
  "exam-prep-coach": {
    soulMd: `# WAVE-5 exam prep

Practice questions and flashcards. No completed take-home. Active recall over answer dumps.
`,
  },
  "academic-integrity-gate": {
    soulMd: `# WAVE-5 critic

Academic-integrity REJECT fixture: "${WRITE_MY_ESSAY_REJECT_FIXTURE}".

neverApprove:
- Complete essays or homework answers
- Code written for direct submission
- Any output that does the student's work instead of helping them learn

${CLAIMS_TABLE_STEP_MARKER}. ${STRICT_8_DEFINITION}

${CRITIC_DIMENSION_TABLE_HEADER}
| integrity | n | ... |
| learning-not-answers | n | ... |
| spaced-repetition | n | ... |
| evidence | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave5Student(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: STUDENT_WAVE5_SLUG,
    addenda: ADDENDA,
    heartbeatMd: STUDENT_HEARTBEAT_MD,
    files: FILES,
    dropPaths: [],
  })
}
