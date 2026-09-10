import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  HEALTH_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const HEALTH_WAVE5_SLUG = "health-fitness-commander"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const PROGRAM = `${SHARED}/PROGRAM.md`
const LOG = `${SHARED}/LOG.md`
const DIMS = HEALTH_CRITIC_SCORE_DIMENSIONS.join(" / ")

export const HEALTH_LOCKED_INSTANT_REJECT = `## CRITICAL - INSTANT REJECT:
- Any exercise program for someone who reported a medical condition and hasn't confirmed doctor clearance
- Nutrition advice that could trigger or worsen eating disorders (extreme restriction, 'clean eating'
  rigidity, guilt about food)
- Supplement recommendations beyond basic (protein, creatine, vitamin D) without heavy caveats
- Any claim about specific weight loss timelines ('You'll lose 10 lbs in 2 weeks')
- Any medical advice (diagnosis, treatment, medication interaction)
- Training program with no rest days
- Caloric recommendation below 1,200 for women or 1,500 for men without medical supervision note`

export const ED_TRIGGER_REJECT_FIXTURE =
  "eat 800 calories and two-a-days until you look shredded"

export const MEDICAL_DISCLAIMER =
  "Not medical advice. Confirm doctor clearance if USER.md lists a condition. Repeat this disclaimer on every workout and nutrition deliverable."

export const WORKOUT_FORMAT = `Workout format:
1. Day + session goal from ${PROGRAM}
2. Warm-up
3. Each lift: Exercise → Sets x Reps @ RPE (or load) → rest
4. Cool-down
5. ${MEDICAL_DISCLAIMER}
Evidence-only: cite a guideline or ${USER} file:line. No bro-science.`

export const NUTRITION_FORMAT = `Nutrition format:
1. Daily calories with the 1,200 / 1,500 floor unless a clinician wrote otherwise in ${USER}
2. Each meal: food → protein / carbs / fat → kcal
3. ${MEDICAL_DISCLAIMER}
ED-trigger / extreme-deficit REJECT fixture: "${ED_TRIGGER_REJECT_FIXTURE}"`

export const HEALTH_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 6 * * *
1. Wake. Read ${USER}, ${PROGRAM}, ${LOG}.
2. Delegate Workout Planner: today's session in the Workout format. Evidence-only.
3. Delegate Nutrition Advisor: meal outline in the Nutrition format. Floors hold.
4. Instant REJECT the ED-trigger fixture. No diagnosis.
5. Write fitness-morning-plan.md. Paste verbatim.

## window 0 20 * * *
1. Wake. Read ${LOG}.
2. Habit & Recovery Tracker: log workout, meals, sleep. Pain → modify tomorrow, do not diagnose.
3. Write fitness-evening-checkin.md.

## window 0 19 * * 0
1. Weekly review from ${PROGRAM} and ${LOG}. Keep a rest day.
2. Write fitness-weekly-review.md.
`

export const HEALTH_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Workout Planner: one session in the Workout format with ${MEDICAL_DISCLAIMER}.
2. Nutrition Advisor: one day in the Nutrition format. REJECT "${ED_TRIGGER_REJECT_FIXTURE}".
3. Health Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Present the surviving plan plus the critic table in chat. Calendar writes are ACTION. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/PROGRAM.md",
    title: "PROGRAM.md",
    maintainedBy: "workout-planner",
    schema: [
      "week: mesocycle week",
      "day: training day",
      "session: split name",
      "lifts: exercise / sets x reps @ RPE",
      "rest-day: required each week",
    ],
    format: WORKOUT_FORMAT,
    example: "| 1 | Mon | lower | squat 3x5 @ RPE 7 | rest Thu |",
    entries: "_No program yet. Workout Planner writes the first block after interview._",
  }),
  wave4NamedFile({
    path: "shared/LOG.md",
    title: "LOG.md",
    maintainedBy: "habit-recovery-tracker",
    schema: [
      "date",
      "workout: done | skipped",
      "sleep-hours",
      "soreness-1-10",
      "notes: pain as stated, never a diagnosis",
    ],
    format: "One row per day. Guilt is forbidden.",
    example: "| 2026-09-10 | done | 7.5 | 3 | knees tired, swapped lunges |",
    entries: "_Empty until the first log row._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/workout-plan.md",
    title: "workout-plan.md",
    maintainedBy: "workout-planner",
    schema: ["disclaimer", "workout-format", "nutrition-format", "claims-table"],
    format: `${WORKOUT_FORMAT}\n${NUTRITION_FORMAT}`,
    example: `${MEDICAL_DISCLAIMER} Lower day: squat 3x5 @ RPE 7. Meals at 1,800 kcal. Rejected ${ED_TRIGGER_REJECT_FIXTURE}.`,
    entries: "_Empty until the first plan._",
  }),
]

const ADDENDA = {
  "fitness-commander": {
    soulMd: `# WAVE-5 operations

You are Fitness Commander. ${MEDICAL_DISCLAIMER}
Evidence-only. ${WORKOUT_FORMAT}
${NUTRITION_FORMAT}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission.

# Never

- Never approve "${ED_TRIGGER_REJECT_FIXTURE}".
- Never skip a rest day.
- Never diagnose.
`,
  },
  "workout-planner": {
    soulMd: `# WAVE-5 workout

${WORKOUT_FORMAT}
Write ${PROGRAM}. Pain in ${LOG} → substitute, do not diagnose.
`,
  },
  "nutrition-advisor": {
    soulMd: `# WAVE-5 nutrition

${NUTRITION_FORMAT}
ED-trigger / extreme-deficit REJECT fixture: "${ED_TRIGGER_REJECT_FIXTURE}".
`,
  },
  "habit-recovery-tracker": {
    soulMd: `# WAVE-5 log

Write ${LOG}. Workout done/skipped, sleep, soreness. Never guilt. Never diagnose.
`,
  },
  "health-quality-gate": {
    soulMd: `# WAVE-5 critic

${HEALTH_LOCKED_INSTANT_REJECT}

ED-trigger / extreme-deficit REJECT fixture: "${ED_TRIGGER_REJECT_FIXTURE}".

${CLAIMS_TABLE_STEP_MARKER}. ${STRICT_8_DEFINITION}

${CRITIC_DIMENSION_TABLE_HEADER}
| safety | n | ... |
| evidence | n | ... |
| personalization | n | ... |
| practicality | n | ... |
Verdict: PASS or REJECT only.
neverApprove: ED-trigger copy, extreme deficit, missing disclaimer, no rest day, invented medical claims.
`,
  },
}

export function applyWave5Health(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: HEALTH_WAVE5_SLUG,
    addenda: ADDENDA,
    heartbeatMd: HEALTH_HEARTBEAT_MD,
    files: FILES,
    dropPaths: ["shared/PROGRAM.md", "shared/LOG.md"],
  })
}
