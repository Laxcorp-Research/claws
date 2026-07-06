export const MEDICAL_HIPAA_RESPONSIBILITY_NOTICE =
  "HIPAA responsibility: You are responsible for HIPAA compliance, including Business Associate Agreements (BAAs) with your communication vendors. Managed-OAuth connections route through Composio, which may not be BAA-covered — for PHI-adjacent channels, use direct API-key tools under your own BAAs (e.g., Twilio with a signed BAA)."

export const COMPLIANCE_NOTICES: Record<string, string> = {
  "medical-practice-manager": MEDICAL_HIPAA_RESPONSIBILITY_NOTICE,
  "law-firm-intake-os":
    "Legal intake responsibility: This Claw supports intake operations only and does not provide legal advice. Intake conversations may have limited privilege before formal engagement, depending on jurisdiction; an attorney must review information and determine next steps.",
  "health-fitness-commander":
    "Health and fitness responsibility: This Claw is not medical advice. Users should consult a physician before beginning or changing exercise, nutrition, or supplement routines, especially with medical conditions. Safety disclaimers are enforced by the Critic.",
  "real-estate-agent-os":
    "Fair Housing responsibility: Communications must comply with Fair Housing rules. Do not steer clients, reference protected classes, or use coded phrases that imply demographic fit for a property or neighborhood.",
  "recruiter-os":
    "Recruiting compliance responsibility: Candidate evaluation must avoid discrimination and bias. Assess demonstrated skills and job-relevant evidence only; avoid age proxies, school-prestige shortcuts, and unsupported culture-fit rejections.",
  "home-services-dispatcher":
    "Emergency responsibility: Safety emergencies must be directed to 911 first. This Claw can help triage and dispatch routine service requests, but gas leaks, carbon monoxide alarms, and life-safety emergencies require emergency services before technician workflows.",
}

export function getComplianceNotice(slug: string | null | undefined): string | null {
  if (!slug) return null
  return COMPLIANCE_NOTICES[slug] ?? null
}
