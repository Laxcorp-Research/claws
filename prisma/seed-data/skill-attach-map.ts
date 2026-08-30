import { ALL_SKILLS } from "./skills-index"
import type { SeedTemplate } from "./types"

/**
 * INFRA-3 attach map: catalog skill slugs per seed agent.
 *
 * Tool-specific skills go on workers that use that tool (primary + alts that
 * have a catalog skill). Domain packs go on every agent of that vertical.
 * Agnostic packs only where they genuinely fit. Orchestrators / critics stay
 * empty unless a domain pack or critic-side agnostic pack applies.
 *
 * Authoring stays `SeedAgent.skills: string[]`. Snapshot normalize + install
 * slug reader turn these into AgentSkill rows.
 */
export const TEMPLATE_SKILL_ATTACH: Record<string, Record<string, string[]>> = {
  "quant-trader": {
    "trade-commander": [],
    "market-scanner": [
      "tavily-search",
      "polymarket-trading",
      "binance-trading",
      "coinbase-trading",
      "alpaca-trading",
      "data-analysis",
    ],
    "signal-analyst": ["tavily-search", "data-analysis"],
    "risk-manager": ["data-analysis", "alpaca-trading"],
    "backtester": ["data-analysis"],
    "portfolio-tracker": [
      "data-analysis",
      "alpaca-trading",
      "binance-trading",
      "coinbase-trading",
    ],
    "trade-thesis-reviewer": [],
  },

  "freelancer-revenue-engine": {
    "revenue-commander": [],
    "lead-hunter": ["tavily-search"],
    "proposal-writer": ["project-scoping"],
    "project-manager": ["google-calendar", "gmail-ops", "project-scoping"],
    "invoice-collections": ["gmail-ops"],
    "business-development-reviewer": [],
  },

  "ecommerce-profit-maximizer": {
    "store-commander": [],
    "product-researcher": ["tavily-search"],
    "listing-optimizer": ["shopify-store"],
    "pricing-intel": ["shopify-store"],
    "review-manager": ["shopify-store"],
    "ad-optimizer": ["shopify-store"],
    "ecommerce-quality-gate": [],
  },

  "youtube-channel-os": {
    "channel-commander": [],
    "trend-scout": ["youtube-data-api", "tavily-search"],
    "idea-generator": ["youtube-data-api", "tavily-search"],
    "title-thumbnail-architect": ["youtube-data-api"],
    "script-builder": ["youtube-data-api"],
    "youtube-seo-optimizer": ["youtube-data-api"],
    "community-growth-engine": ["youtube-data-api"],
    "content-quality-gate": [],
  },

  "twitter-growth-machine": {
    "twitter-commander": [],
    "trend-topic-scout": ["twitter-api", "tavily-search"],
    "content-writer": ["twitter-api"],
    "engagement-strategist": ["twitter-api"],
    "analytics-growth-tracker": ["twitter-api"],
    "social-content-reviewer": [],
  },

  "newsletter-empire": {
    "newsletter-commander": [],
    "topic-researcher": ["twitter-oauth", "linkedin-api"],
    // convertkit is the catalog alternative on beehiiv-api. Missing beehiiv
    // SKILL.md is WAVE-2 - do not pretend convertkit is beehiiv.
    "draft-writer": ["convertkit-newsletter"],
    "growth-strategist": ["twitter-oauth", "linkedin-api"],
    "monetization-optimizer": [],
    "editorial-quality-gate": [],
  },

  "podcast-production-studio": {
    "podcast-commander": [],
    "guest-researcher-booker": [
      "tavily-search",
      "gmail-ops",
      "google-calendar",
      "linkedin-api",
    ],
    "episode-planner": [],
    "show-notes-seo-writer": ["tavily-search"],
    "content-repurposer": ["twitter-oauth", "linkedin-api"],
    "podcast-quality-gate": [],
  },

  "b2b-sales-machine": {
    "sales-commander": ["can-spam"],
    "icp-researcher": ["tavily-search", "apollo-search", "lead-scoring"],
    "lead-enricher": ["apollo-search", "clay-enrichment"],
    "sequence-writer": ["instantly-email", "cold-email-writing", "can-spam"],
    "reply-handler": ["instantly-email", "hubspot-crm", "can-spam"],
    "pipeline-manager": [
      "hubspot-crm",
      "salesforce-crm",
      "crm-management",
      "calendly-scheduling",
    ],
    "outbound-quality-gate": ["can-spam"],
  },

  "agency-operations-os": {
    "agency-commander": [],
    "intake-scoping-agent": ["project-scoping", "gmail-ops"],
    "resource-allocator": ["linear-pm", "asana-pm", "clickup-pm"],
    "client-reporter": ["slack-messaging", "gmail-ops"],
    "task-manager": ["linear-pm", "asana-pm", "clickup-pm"],
    "finance-tracker": [],
    "agency-quality-gate": [],
  },

  "founders-chief-of-staff": {
    "chief-of-staff": [],
    "briefing-compiler": [
      "gmail-ops",
      "google-calendar",
      "tavily-search",
      "slack-messaging",
    ],
    "meeting-prep-agent": ["google-calendar", "gmail-ops", "linkedin-api"],
    "action-tracker": ["linear-pm", "asana-pm", "google-calendar"],
    "communication-drafter": ["gmail-ops", "slack-messaging"],
    "executive-quality-gate": [],
  },

  "seo-empire-builder": {
    "seo-commander": [],
    "keyword-strategist": ["google-search-console", "ahrefs-seo", "tavily-search"],
    "content-writer": ["seo-content-writing", "tavily-search"],
    "technical-seo-monitor": ["google-search-console", "google-analytics"],
    "backlink-prospector": ["ahrefs-seo", "tavily-search"],
    "rank-tracker": ["google-search-console", "google-analytics"],
    "seo-quality-gate": [],
  },

  "real-estate-agent-os": {
    "listing-commander": ["fair-housing"],
    "lead-qualifier": ["fair-housing", "gmail-ops", "lead-scoring"],
    "market-intel-agent": ["fair-housing", "tavily-search"],
    "showing-coordinator": ["fair-housing", "google-calendar", "gmail-ops"],
    "client-communicator": ["fair-housing", "gmail-ops"],
    "real-estate-quality-gate": ["fair-housing"],
  },

  "recruiter-os": {
    "recruiting-commander": [],
    "sourcer": ["linkedin-api", "tavily-search"],
    "screening-agent": [],
    "interview-coordinator": ["google-calendar", "gmail-ops"],
    "client-reporter": ["gmail-ops"],
    "recruiting-quality-gate": [],
  },

  "medical-practice-manager": {
    "practice-commander": ["hipaa-compliance"],
    "patient-intake-agent": ["hipaa-compliance", "twilio-sms"],
    "appointment-manager": ["hipaa-compliance", "twilio-sms", "google-calendar"],
    "recall-reactivation-agent": ["hipaa-compliance", "twilio-sms"],
    "review-reputation-manager": ["hipaa-compliance"],
    "healthcare-communication-gate": ["hipaa-compliance"],
  },

  "law-firm-intake-os": {
    "intake-commander": ["legal-communication", "emergency-triage"],
    "first-contact-agent": ["legal-communication", "emergency-triage", "gmail-ops"],
    "case-qualifier": ["legal-communication", "emergency-triage"],
    "conflict-checker": ["legal-communication", "emergency-triage"],
    "consultation-scheduler": [
      "legal-communication",
      "emergency-triage",
      "gmail-ops",
      "google-calendar",
    ],
    "legal-communication-gate": ["legal-communication", "emergency-triage"],
  },

  "home-services-dispatcher": {
    "dispatch-commander": ["emergency-triage"],
    "call-handler": ["emergency-triage", "twilio-sms"],
    "dispatch-coordinator": ["emergency-triage", "twilio-sms", "google-calendar"],
    "customer-follow-up-agent": ["emergency-triage", "twilio-sms"],
    "service-communication-gate": ["emergency-triage"],
  },

  "health-fitness-commander": {
    "fitness-commander": [],
    "workout-planner": ["google-calendar"],
    "nutrition-advisor": [],
    "habit-recovery-tracker": ["google-calendar"],
    "health-quality-gate": [],
  },

  "student-accelerator": {
    "study-commander": ["academic-integrity"],
    "study-planner": ["academic-integrity", "google-calendar", "notion-docs"],
    "research-assistant": ["academic-integrity", "tavily-search"],
    "exam-prep-coach": ["academic-integrity"],
    "academic-integrity-gate": ["academic-integrity"],
  },

  "job-hunter-os": {
    "job-hunt-commander": [],
    "opportunity-scout": ["tavily-search", "linkedin-api"],
    "application-crafter": ["gmail-ops"],
    "interview-coach": ["interview-preparation"],
    "negotiation-advisor": ["salary-negotiation"],
    "job-search-quality-gate": ["interview-preparation", "salary-negotiation"],
  },

  "developer-productivity-os": {
    "dev-commander": [],
    "pr-reviewer": ["github-ops", "code-review-framework"],
    "issue-triager": ["github-ops", "linear-pm", "jira-pm"],
    "doc-generator": ["github-ops", "notion-docs"],
    "security-scanner": ["github-ops"],
    "standup-writer": ["github-ops", "slack-messaging"],
    "code-quality-gate": ["code-review-framework"],
  },
}

const CATALOG_SLUGS = new Set(ALL_SKILLS.map((s) => s.slug))

for (const [templateSlug, agents] of Object.entries(TEMPLATE_SKILL_ATTACH)) {
  for (const [agentSlug, skills] of Object.entries(agents)) {
    for (const skillSlug of skills) {
      if (!CATALOG_SLUGS.has(skillSlug)) {
        throw new Error(
          `INFRA-3: ${templateSlug}/${agentSlug} attaches unknown skill "${skillSlug}"`,
        )
      }
    }
  }
}

/** Stamp attach-map skills onto a seed template. Throws if map/agent coverage drifts. */
export function applySkillAttach(template: SeedTemplate): SeedTemplate {
  const map = TEMPLATE_SKILL_ATTACH[template.slug]
  if (!map) {
    throw new Error(`INFRA-3: missing skill attach map for template ${template.slug}`)
  }

  const agentSlugs = new Set(template.agents.map((a) => a.agentSlug))
  for (const mappedSlug of Object.keys(map)) {
    if (!agentSlugs.has(mappedSlug)) {
      throw new Error(
        `INFRA-3: attach map has unknown agent ${template.slug}/${mappedSlug}`,
      )
    }
  }
  for (const agent of template.agents) {
    if (!(agent.agentSlug in map)) {
      throw new Error(
        `INFRA-3: agent ${template.slug}/${agent.agentSlug} missing from attach map`,
      )
    }
  }

  return {
    ...template,
    agents: template.agents.map((agent) => ({
      ...agent,
      skills: [...map[agent.agentSlug]!],
    })),
  }
}
