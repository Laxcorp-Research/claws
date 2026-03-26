export interface SeedAgent {
  name: string
  agentSlug: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  model: string
  roleDescription: string
  soulMd: string
  agentsMd: string
  heartbeatMd: string
  skills: string[]
  position: { x: number; y: number }
}

export interface SeedConnection {
  sourceSlug: string
  targetSlug: string
  condition: "ON_COMPLETE" | "ON_APPROVAL" | "ON_REJECTION" | "ON_SCHEDULE"
}

export interface SeedTool {
  slug: string
  name: string
  category: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO"
  required: boolean
  alternatives?: string[]
}

export interface SeedSkill {
  name: string
  slug: string
  description: string
  skillMd: string
  type: "BUILT_IN" | "TOOL_SPECIFIC" | "TOOL_AGNOSTIC" | "DOMAIN_WORKFLOW"
  category: "CORE" | "CRM" | "EMAIL_SENDER" | "EMAIL_READER" | "LEAD_DATABASE" | "ENRICHMENT" | "SOCIAL" | "CALENDAR" | "PROJECT_MGMT" | "ANALYTICS" | "SEARCH" | "FINANCE" | "TRADING" | "CONTENT" | "COMMUNICATION" | "SECURITY" | "CUSTOM"
  icon: string
  compatibleTools: string[]
  requiresToolConnection: boolean
  requiredToolCategory?: string
  isBuiltIn: boolean
  permissions: string[]
}

export interface SeedTemplate {
  name: string
  slug: string
  tagline: string
  description: string
  flowDescription: string
  category: "MONEY_MAKING" | "CREATOR" | "BUSINESS_OPS" | "VERTICAL" | "LIFESTYLE"
  price: number
  agentCount: number
  featured: boolean
  sortOrder: number
  legalDisclaimer?: string
  agents: SeedAgent[]
  connections: SeedConnection[]
  tools: SeedTool[]
}
