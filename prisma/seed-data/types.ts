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
  /** Critic quality floor. Regulated templates must be ≥ 8 (X3). */
  qualityThreshold?: number
}

/** Workspace choreography knobs embedded in workspaceSnapshot (WIRE-FULL). */
export interface SeedWorkspaceKnobs {
  maxRevisionRounds: number
  deliveryMode: "APPROVAL_REQUIRED" | "AUTO_PROCEED"
}

export interface SeedSharedFile {
  path: string
  content: string
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
  /**
   * When true, seed embeds recommendedAlwaysOn into workspaceSnapshot JSON
   * so deploy UI can surface an Always-on recommendation (no Prisma column).
   */
  recommendedAlwaysOn?: boolean
  agents: SeedAgent[]
  connections: SeedConnection[]
  tools: SeedTool[]
  /** Defaults applied when omitted: rounds=3, APPROVAL_REQUIRED. */
  knobs?: SeedWorkspaceKnobs
  /**
   * INFRA-2: logical shared files (path relative to each agent workspace).
   * Applied by applySharedFiles - not authored inline in the 20 template files.
   */
  files?: SeedSharedFile[]
}
