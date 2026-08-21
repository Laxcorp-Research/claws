import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"

type SnapshotAgent = {
  name: string
  agentSlug: string
  role: string
  soulMd: string
}

function seedWorkspaceSnapshot(slug: string): { agents: SnapshotAgent[] } {
  const template = ALL_TEMPLATES.find((t) => t.slug === slug)
  if (!template) throw new Error(`Missing seed template: ${slug}`)

  return JSON.parse(JSON.stringify({
    agents: template.agents.map((a) => ({
      name: a.name,
      agentSlug: a.agentSlug,
      role: a.role,
      color: a.color,
      model: a.model,
      roleDescription: a.roleDescription,
      soulMd: a.soulMd,
      agentsMd: a.agentsMd,
      heartbeatMd: a.heartbeatMd,
      skills: a.skills,
      positionX: a.position.x,
      positionY: a.position.y,
    })),
    connections: template.connections,
    tools: template.tools,
    flowDescription: template.flowDescription,
    legalDisclaimer: template.legalDisclaimer ?? null,
  })) as { agents: SnapshotAgent[] }
}

function soulMd(slug: string, agentSlug: string): string {
  const agent = seedWorkspaceSnapshot(slug).agents.find((a) => a.agentSlug === agentSlug)
  if (!agent) throw new Error(`Missing agent ${agentSlug} in ${slug}`)
  return agent.soulMd
}

function expectContainsAll(content: string, lines: string[]): void {
  for (const line of lines) {
    expect(content).toContain(line)
  }
}

describe("regulated template compliance blocks", () => {
  it("medical-practice-manager contains HIPAA rules and instant-reject review-response guard", () => {
    expectContainsAll(soulMd("medical-practice-manager", "practice-commander"), [
      "# HIPAA Compliance Rules (CRITICAL - applies to ALL agents)",
      "Appointment reminders may NOT include: reason for visit, procedure type, or any clinical detail",
      "When in doubt about whether something is PHI (Protected Health Information): DON'T include it",
    ])

    const critic = soulMd("medical-practice-manager", "healthcare-communication-gate")
    expectContainsAll(critic, [
      "## CRITICAL - INSTANT REJECT:",
      "ANY message containing PHI beyond appointment basics",
      "Review response that confirms a patient visited the practice",
      "NEVER reference their specific visit or treatment",
    ])
    expect(critic).not.toContain("# Automatic Rejection Triggers")
  })

  it("law-firm-intake-os contains intake disclaimer, 15-minute emergency triage, and UPL rejection guard", () => {
    expectContainsAll(soulMd("law-firm-intake-os", "first-contact-agent"), [
      "# Legal Compliance (CRITICAL)",
      "this is for intake purposes only and doesn't constitute legal advice",
      "Human must be notified within 15 minutes.",
    ])

    const critic = soulMd("law-firm-intake-os", "legal-communication-gate")
    expectContainsAll(critic, [
      "## CRITICAL - INSTANT REJECT:",
      "ANY communication that constitutes legal advice",
      "ANY prediction of case outcomes",
      "ANY communication during an active case that could waive privilege",
    ])
    expect(critic).not.toContain("# Automatic Rejection Triggers")
  })

  it("health-fitness-commander contains critic instant rejects and workout safety blocks", () => {
    const critic = soulMd("health-fitness-commander", "health-quality-gate")
    expectContainsAll(critic, [
      "## CRITICAL - INSTANT REJECT:",
      "hasn't confirmed doctor clearance",
      "Training program with no rest days",
      "Caloric recommendation below 1,200 for women or 1,500 for men",
    ])
    expect(critic).not.toContain("# Automatic Rejection Triggers")

    expectContainsAll(soulMd("health-fitness-commander", "workout-planner"), [
      "# Safety Rules",
      "NEVER ignore reported pain or discomfort - modify or substitute immediately",
      "# What You NEVER Do",
      "Never program for someone with a medical condition without them confirming doctor approval",
    ])
  })

  it("real-estate-agent-os contains Fair Housing coded-phrase instant-reject guard", () => {
    expectContainsAll(soulMd("real-estate-agent-os", "real-estate-quality-gate"), [
      "## CRITICAL - Fair Housing Compliance:",
      "INSTANTLY REJECT any communication that:",
      "Uses phrases like 'family neighborhood' (familial status)",
      "racial/economic steering",
    ])
  })

  it("recruiter-os contains anti-discrimination age-proxy and culture-fit guards", () => {
    const critic = soulMd("recruiter-os", "recruiting-quality-gate")
    expectContainsAll(critic, [
      "## CRITICAL - Anti-Discrimination:",
      "Uses age as a factor (even indirectly - 'overqualified' is often age proxy)",
      "Uses 'culture fit' as a rejection reason without specific behavioral evidence",
      "Penalizes employment gaps without context",
    ])
    expect(critic).not.toContain("# Automatic Rejection Triggers")
  })

  it("home-services-dispatcher contains instant-reject safety, quote, DIY, and diagnosis guards", () => {
    expectContainsAll(soulMd("home-services-dispatcher", "service-communication-gate"), [
      "## CRITICAL - INSTANT REJECT:",
      "Any message that doesn't direct a safety emergency to 911 first",
      "Any price quote not authorized by the company",
      "Any diagnosis of the problem without a tech visit",
    ])
  })
})
