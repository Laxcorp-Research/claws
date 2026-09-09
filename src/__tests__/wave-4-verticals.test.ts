import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { parseHeartbeatWindowScripts } from "@/lib/openclaw/heartbeat-md-cron"
import { RE_FIRST_MISSION_PROSE } from "../../prisma/seed-data/wave-4-real-estate"
import { RECRUITER_FIRST_MISSION_PROSE } from "../../prisma/seed-data/wave-4-recruiter"
import { MEDICAL_FIRST_MISSION_PROSE } from "../../prisma/seed-data/wave-4-medical"
import { LAW_FIRST_MISSION_PROSE } from "../../prisma/seed-data/wave-4-law"
import { HOME_FIRST_MISSION_PROSE } from "../../prisma/seed-data/wave-4-home"
import {
  CLAIMS_TABLE_STEP_MARKER,
  STRICT_8_DEFINITION,
  RE_CRITIC_SCORE_DIMENSIONS,
  RECRUITER_CRITIC_SCORE_DIMENSIONS,
  MEDICAL_CRITIC_SCORE_DIMENSIONS,
  LAW_CRITIC_SCORE_DIMENSIONS,
  HOME_CRITIC_SCORE_DIMENSIONS,
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

describe("WAVE-4 Real Estate Agent OS", () => {
  const slug = "real-estate-agent-os"

  it("CMA format, showing cap 5, 60-second lead, Fair Housing locked", () => {
    expect(agent(slug, "market-intel-agent").soulMd).toContain("CMA format")
    expect(agent(slug, "showing-coordinator").soulMd).toContain("at most 5 showings")
    expect(agent(slug, "lead-qualifier").soulMd).toContain("60 seconds")
    const critic = agent(slug, "real-estate-quality-gate").soulMd
    expect(critic).toContain("## CRITICAL - Fair Housing Compliance:")
    expect(critic).toContain("Uses phrases like 'family neighborhood' (familial status)")
    expect(critic).toContain("racial/economic steering")
    for (const dim of RE_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain(CLAIMS_TABLE_STEP_MARKER)
    expect(critic).toContain(STRICT_8_DEFINITION)
    expect(critic).toContain("neverApprove")
    expect(agent(slug, "listing-commander").soulMd).toContain("MLS status change is an ACTION")
  })

  it("named files MARKET / LISTINGS / cma", () => {
    expectNamedFiles(slug, [
      "shared/MARKET.md",
      "shared/LISTINGS.md",
      "shared/deliverables/cma.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "listing-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(RE_FIRST_MISSION_PROSE)
    expect(pending).toContain("ACTION card")
  })
})

describe("WAVE-4 Recruiter OS", () => {
  const slug = "recruiter-os"

  it("scoring rubric, screening format, ATS ACTION, bias locked", () => {
    expect(agent(slug, "screening-agent").soulMd).toContain("Candidate scoring rubric")
    expect(agent(slug, "screening-agent").soulMd).toContain("Screening format")
    expect(agent(slug, "recruiting-commander").soulMd).toContain("ACTION card")
    const critic = agent(slug, "recruiting-quality-gate").soulMd
    expect(critic).toContain("Uses age as a factor (even indirectly - 'overqualified' is often age proxy)")
    expect(critic).toContain("Uses 'culture fit' as a rejection reason without specific behavioral evidence")
    expect(critic).toContain("Penalizes employment gaps without context")
    expect(critic).not.toContain("# Automatic Rejection Triggers")
    for (const dim of RECRUITER_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files SCORECARD / SCREENING / ATS", () => {
    expectNamedFiles(slug, [
      "shared/SCORECARD.md",
      "shared/SCREENING.md",
      "shared/ATS.md",
      "shared/deliverables/screening-pack.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "recruiting-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(RECRUITER_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-4 Medical Practice Manager", () => {
  const slug = "medical-practice-manager"

  it("consent-gated recall, reminder format, PHI fixture, HIPAA locked", () => {
    expect(agent(slug, "practice-commander").soulMd).toContain("# HIPAA Compliance Rules (CRITICAL - applies to ALL agents)")
    expect(agent(slug, "practice-commander").soulMd).toContain("Appointment reminders may NOT include: reason for visit, procedure type, or any clinical detail")
    expect(agent(slug, "practice-commander").soulMd).toContain("When in doubt about whether something is PHI (Protected Health Information): DON'T include it")
    expect(agent(slug, "appointment-manager").soulMd).toContain("Reminder format")
    expect(agent(slug, "recall-reactivation-agent").soulMd).toContain("Consent-gated recall")
    const critic = agent(slug, "healthcare-communication-gate").soulMd
    expect(critic).toContain("## CRITICAL - INSTANT REJECT:")
    expect(critic).toContain("ANY message containing PHI beyond appointment basics")
    expect(critic).toContain("Review response that confirms a patient visited the practice")
    expect(critic).toContain("NEVER reference their specific visit or treatment")
    expect(critic).toContain("PHI reject fixture")
    expect(critic).not.toContain("# Automatic Rejection Triggers")
    for (const dim of MEDICAL_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
  })

  it("named files RECALL / REMINDERS", () => {
    expectNamedFiles(slug, [
      "shared/RECALL.md",
      "shared/REMINDERS.md",
      "shared/deliverables/reminder-draft.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "practice-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(MEDICAL_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-4 Law Firm Intake OS", () => {
  const slug = "law-firm-intake-os"

  it("qualification, 15-min emergency ACTION, conflict format, UPL fixture locked", () => {
    expect(agent(slug, "first-contact-agent").soulMd).toContain("# Legal Compliance (CRITICAL)")
    expect(agent(slug, "first-contact-agent").soulMd).toContain("this is for intake purposes only and doesn't constitute legal advice")
    expect(agent(slug, "first-contact-agent").soulMd).toContain("Human must be notified within 15 minutes.")
    expect(agent(slug, "case-qualifier").soulMd).toContain("Intake qualification per practice area")
    expect(agent(slug, "conflict-checker").soulMd).toContain("Conflict-check format")
    expect(agent(slug, "intake-commander").soulMd).toContain("ACTION card")
    const critic = agent(slug, "legal-communication-gate").soulMd
    expect(critic).toContain("## CRITICAL - INSTANT REJECT:")
    expect(critic).toContain("ANY communication that constitutes legal advice")
    expect(critic).toContain("ANY prediction of case outcomes")
    expect(critic).toContain("ANY communication during an active case that could waive privilege")
    expect(critic).toContain("UPL reject fixture")
    expect(critic).not.toContain("# Automatic Rejection Triggers")
    for (const dim of LAW_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
  })

  it("named files INTAKE / CONFLICTS", () => {
    expectNamedFiles(slug, [
      "shared/INTAKE.md",
      "shared/CONFLICTS.md",
      "shared/deliverables/intake-pack.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "intake-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(LAW_FIRST_MISSION_PROSE)
  })
})

describe("WAVE-4 Home Services Dispatcher", () => {
  const slug = "home-services-dispatcher"

  it("gas/CO 911 first, dispatch format, follow-up ACTION, safety locked", () => {
    expect(agent(slug, "call-handler").soulMd).toContain("Emergency triage tree")
    expect(agent(slug, "call-handler").soulMd).toContain("evacuate, call 911")
    expect(agent(slug, "dispatch-coordinator").soulMd).toContain("Dispatch format")
    expect(agent(slug, "customer-follow-up-agent").soulMd).toContain("ACTION")
    const critic = agent(slug, "service-communication-gate").soulMd
    expect(critic).toContain("## CRITICAL - INSTANT REJECT:")
    expect(critic).toContain("Any message that doesn't direct a safety emergency to 911 first")
    expect(critic).toContain("Any price quote not authorized by the company")
    expect(critic).toContain("Any diagnosis of the problem without a tech visit")
    for (const dim of HOME_CRITIC_SCORE_DIMENSIONS) {
      expect(critic).toContain(dim)
    }
    expect(critic).toContain("neverApprove")
  })

  it("named files TRIAGE / DISPATCH", () => {
    expectNamedFiles(slug, [
      "shared/TRIAGE.md",
      "shared/DISPATCH.md",
      "shared/deliverables/dispatch-board.md",
    ])
    expect(parseHeartbeatWindowScripts(agent(slug, "dispatch-commander").heartbeatMd).length).toBe(4)
  })

  it("same-session mini-mission", () => {
    const pending = formatInterviewBootSection({
      interviewCompleted: false,
      pack: getInterviewPack(slug),
      templateSlug: slug,
    })
    expect(pending).toContain(HOME_FIRST_MISSION_PROSE)
  })
})
