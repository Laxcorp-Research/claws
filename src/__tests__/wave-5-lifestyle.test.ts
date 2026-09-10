import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import {
  HEALTH_FIRST_MISSION_PROSE,
  HEALTH_LOCKED_INSTANT_REJECT,
  ED_TRIGGER_REJECT_FIXTURE,
  MEDICAL_DISCLAIMER,
  WORKOUT_FORMAT,
  NUTRITION_FORMAT,
} from "../../prisma/seed-data/wave-5-health"
import {
  STUDENT_FIRST_MISSION_PROSE,
  WRITE_MY_ESSAY_REJECT_FIXTURE,
  SPACED_REPETITION_PLANNER,
} from "../../prisma/seed-data/wave-5-student"
import {
  JOB_FIRST_MISSION_PROSE,
  ATS_RESUME_FORMAT,
  STAR_PREP_FORMAT,
  NEGOTIATION_SCRIPT,
} from "../../prisma/seed-data/wave-5-job"
import {
  DEV_FIRST_MISSION_PROSE,
  PR_REVIEW_SEVERITY,
  CVSS_PRIORITIZATION,
  STANDUP_FORMAT,
} from "../../prisma/seed-data/wave-5-dev"
import {
  CLAIMS_TABLE_STEP_MARKER,
  STRICT_8_DEFINITION,
  HEALTH_CRITIC_SCORE_DIMENSIONS,
  STUDENT_CRITIC_SCORE_DIMENSIONS,
  JOB_CRITIC_SCORE_DIMENSIONS,
  DEV_CRITIC_SCORE_DIMENSIONS,
} from "@/lib/critic/claims-table"
import { formatInterviewBootSection, getInterviewPack } from "@/lib/user-md-interview"

function template(slug: string) {
  const t = ALL_TEMPLATES.find((x) => x.slug === slug)
  if (!t) throw new Error(`${slug} missing`)
  return t
}

function agent(slug: string, agentSlug: string) {
  const a = template(slug).agents.find((x) => x.agentSlug === agentSlug)
  if (!a) throw new Error(agentSlug)
  return a
}

function expectNamedFiles(slug: string, paths: string[]) {
  const files = template(slug).files ?? []
  for (const name of paths) {
    const file = files.find((f) => f.path === name)
    expect(file, name).toBeDefined()
    expect(file!.content.length).toBeLessThan(8000)
    expect(file!.content).toContain("## Schema")
    expect(file!.content).toContain("## Format")
    expect(file!.content).toContain("## Example")
    expect(file!.content).toContain("## Entries")
  }
}

describe("WAVE-5 Health & Fitness Commander", () => {
  const slug = "health-fitness-commander"

  it("evidence-only, ED-trigger REJECT, disclaimer, formats, critic locked", () => {
    expect(agent(slug, "workout-planner").soulMd).toContain("Workout format")
    expect(agent(slug, "nutrition-advisor").soulMd).toContain(ED_TRIGGER_REJECT_FIXTURE)
    expect(agent(slug, "fitness-commander").soulMd).toContain(MEDICAL_DISCLAIMER)
    expect(WORKOUT_FORMAT).toContain("Sets x Reps")
    expect(NUTRITION_FORMAT).toContain("1,200")
    const critic = agent(slug, "health-quality-gate").soulMd
    expect(critic).toContain(HEALTH_LOCKED_INSTANT_REJECT.split("\n")[0]!)
    expect(critic).toContain("Caloric recommendation below 1,200")
    expect(critic).toContain(ED_TRIGGER_REJECT_FIXTURE)
    for (const dim of HEALTH_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(critic).toContain(STRICT_8_DEFINITION)
    expect(critic).toContain("neverApprove")
  })

  it("named files PROGRAM / LOG / workout-plan", () => {
    expectNamedFiles(slug, [
      "shared/PROGRAM.md",
      "shared/LOG.md",
      "shared/deliverables/workout-plan.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "fitness-commander").heartbeatMd).length).toBe(3)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(HEALTH_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-5 Student Accelerator", () => {
  const slug = "student-accelerator"

  it("spaced-repetition planner and write-my-essay REJECT locked", () => {
    expect(agent(slug, "study-planner").soulMd).toContain(SPACED_REPETITION_PLANNER.split("\n")[0]!)
    const critic = agent(slug, "academic-integrity-gate").soulMd
    expect(critic).toContain(WRITE_MY_ESSAY_REJECT_FIXTURE)
    expect(critic).toContain("Complete essays or homework answers")
    for (const dim of STUDENT_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files COURSES / DEADLINES / study-plan", () => {
    expectNamedFiles(slug, [
      "shared/COURSES.md",
      "shared/DEADLINES.md",
      "shared/deliverables/study-plan.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "study-commander").heartbeatMd).length).toBe(3)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(STUDENT_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-5 Job Hunter OS", () => {
  const slug = "job-hunter-os"

  it("ATS resume, STAR, negotiation, gmail submit ACTION", () => {
    expect(agent(slug, "application-crafter").soulMd).toContain("ATS-tailored resume format")
    expect(agent(slug, "interview-coach").soulMd).toContain("STAR prep")
    expect(agent(slug, "negotiation-advisor").soulMd).toContain("Negotiation script")
    expect(agent(slug, "job-hunt-commander").soulMd).toContain("Application submit via gmail is ACTION")
    expect(ATS_RESUME_FORMAT).toContain("ATS")
    expect(STAR_PREP_FORMAT).toContain("Situation")
    expect(NEGOTIATION_SCRIPT).toContain("Walk-away")
    const critic = agent(slug, "job-search-quality-gate").soulMd
    for (const dim of JOB_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files TARGETS / APPLICATIONS / application-pack", () => {
    expectNamedFiles(slug, [
      "shared/TARGETS.md",
      "shared/APPLICATIONS.md",
      "shared/deliverables/application-pack.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "job-hunt-commander").heartbeatMd).length).toBe(3)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(JOB_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-5 Developer Productivity OS", () => {
  const slug = "developer-productivity-os"

  it("severity tiers, CVSS, standup, github PR comment ACTION", () => {
    expect(agent(slug, "pr-reviewer").soulMd).toContain("PR-review severity tiers")
    expect(agent(slug, "security-scanner").soulMd).toContain("CVE / CVSS")
    expect(agent(slug, "standup-writer").soulMd).toContain("Standup format")
    expect(agent(slug, "dev-commander").soulMd).toContain("PR comment via github is ACTION")
    expect(PR_REVIEW_SEVERITY).toContain("worked example")
    expect(CVSS_PRIORITIZATION).toContain("CVSS")
    expect(STANDUP_FORMAT).toContain("Yesterday")
    const critic = agent(slug, "code-quality-gate").soulMd
    for (const dim of DEV_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files ISSUES / STANDUP / pr-review", () => {
    expectNamedFiles(slug, [
      "shared/ISSUES.md",
      "shared/STANDUP.md",
      "shared/deliverables/pr-review.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "dev-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(DEV_FIRST_MISSION_PROSE)
  })
})
