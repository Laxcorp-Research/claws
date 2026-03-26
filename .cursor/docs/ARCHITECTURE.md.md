# Claws — Production Architecture Document
## Version 1.0 | March 2026 | Confidential

---

## Table of Contents

1. System Overview & Design Principles
2. Infrastructure Architecture
3. Database Schema (Complete)
4. Authentication & Authorization
5. API Design (All Endpoints)
6. Security Architecture
7. OpenClaw Integration Layer
8. Cloud Deployment Engine
9. Real-Time Monitoring System
9.5. Trading Claw — Risk Management Architecture
10. Payment & Billing System
11. The Visual Builder (React Flow Architecture)
12. Error Handling & Resilience
13. Testing Strategy
14. Observability & Logging
15. Performance & Scaling
16. CI/CD Pipeline
17. Environment Configuration
18. Migration & Rollback Strategy
19. Multi-Agent Hierarchy Architecture (Orchestrator Pattern)
20. Tool Connection Architecture (Integration Layer)

---

## 1. System Overview & Design Principles

### What Claws Is

Claws is a web platform that abstracts OpenClaw's CLI-based agent system into a visual interface. Users build multi-agent AI teams through a drag-and-drop builder, deploy them to managed cloud infrastructure, purchase pre-built agent templates from a store, and monitor agent activity through a real-time dashboard.

### Design Principles

**Principle 1: Agent-runtime agnostic.** The platform generates workspace configuration files. Today those configs target OpenClaw. The architecture must allow swapping to another agent runtime (Claude Code, custom runtime, etc.) without rewriting the application. The `generator` module is the only component that knows about OpenClaw's file format.

**Principle 2: Zero-trust agent execution.** Customer agent containers run in complete isolation. One customer's container cannot access another's. API keys are encrypted at rest and only decrypted inside the container at runtime. No customer secrets ever touch our application database in plaintext.

**Principle 3: Fail-safe over fail-fast for agent operations.** When an agent container crashes, it auto-restarts with exponential backoff. When our platform has downtime, running containers continue operating independently. The platform is a control plane, not a data plane.

**Principle 4: Defensive cost management.** Every API call an agent makes costs money. The platform enforces per-workspace spending limits, alerts on anomalous usage, and can hard-stop containers that exceed budget thresholds. A misconfigured heartbeat must not be able to burn $500 overnight.

**Principle 5: Audit everything.** Every agent action, every deployment, every configuration change, every human approval/rejection is logged with timestamp, actor, and before/after state. This is essential for debugging agent behavior and for enterprise compliance.

---

## 2. Infrastructure Architecture

```
                        ┌──────────────────────────────────┐
                        │          CLOUDFLARE               │
                        │    CDN + DDoS + WAF + DNS         │
                        └──────────────┬───────────────────┘
                                       │
                        ┌──────────────▼───────────────────┐
                        │          VERCEL                    │
                        │    Next.js App (Frontend + API)    │
                        │    - Server Components (Store)     │
                        │    - Client Components (Builder)   │
                        │    - API Routes (Backend)          │
                        │    - Edge Middleware (Auth check)   │
                        └───┬──────────┬───────────────────┘
                            │          │
              ┌─────────────▼──┐  ┌────▼─────────────────────┐
              │   NEON (PostgreSQL)     │  │   AWS / DIGITALOCEAN      │
              │   - PostgreSQL │  │   Container Host          │
              │   - Row Level  │  │                           │
              │     Security   │  │  ┌───────┐ ┌───────┐     │
              │   - Realtime   │  │  │Cust A │ │Cust B │     │
              │     (for SSE)  │  │  │OpenClaw│ │OpenClaw│    │
              └────────────────┘  │  │Container│Container│    │
                                  │  └───────┘ └───────┘     │
              ┌────────────────┐  │  ┌───────┐ ┌───────┐     │
              │   UPSTASH      │  │  │Cust C │ │Cust D │     │
              │   Redis        │  │  │OpenClaw│ │OpenClaw│    │
              │   - Rate limit │  │  │Container│Container│    │
              │   - Job queue  │  │  └───────┘ └───────┘     │
              │   - Cache      │  └───────────────────────────┘
              └────────────────┘
                                  ┌───────────────────────────┐
              ┌────────────────┐  │   AWS S3                   │
              │   DODO PAYMENTS│  │   - Workspace exports      │
              │   - Payments   │  │   - Agent output files     │
              │   - Subscript. │  │   - Backup snapshots       │
              └────────────────┘  └───────────────────────────┘
```

### Why This Stack

- **Vercel:** Zero-config deployment for Next.js. Edge middleware for auth. Serverless functions scale automatically. Free tier for development, Pro ($20/mo) for production.
- **Neon:** Serverless PostgreSQL. Scales to zero on free tier, auto-scales on paid. Excellent Prisma + Vercel integration. No connection pooling headaches (built-in). Free tier generous, Pro at $19/mo.
- **Upstash Redis:** Serverless Redis for rate limiting API routes, caching frequently accessed data (Claw templates), and job queues (deployment tasks). Pay-per-request pricing.
- **AWS ECS or DigitalOcean App Platform:** For running customer OpenClaw containers. Each customer gets an isolated Docker container. We manage via Docker API / container orchestration.
- **Cloudflare:** CDN, DDoS protection, WAF rules, DNS management. Free tier covers most needs.

---

## 3. Database Schema (Complete)

### Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── AUTH & USERS ───────────────────────────────────────

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  name            String?
  avatarUrl       String?
  emailVerified   DateTime?
  hashedPassword  String?
  
  // Billing
  dodoCustomerId    String?   @unique
  hasActiveSubscription Boolean @default(false)
  subscriptionId      String?   // Dodo Payments subscription ID
  subscriptionEndsAt  DateTime?
  
  // Limits
  maxWorkspaces       Int       @default(20)
  maxAgentsPerWorkspace Int     @default(50)
  monthlyApiSpendLimit Float    @default(50.0) // USD
  
  // Onboarding
  onboardingCompleted Boolean   @default(false) // Set true after first onboarding flow
  
  // Trial
  trialUsed       Boolean   @default(false)  // True after first deploy (3-day trial)
  trialStartedAt  DateTime?
  trialEndsAt     DateTime?
  
  // Relations
  accounts        Account[]
  sessions        Session[]
  workspaces      Workspace[]
  purchases       Purchase[]
  apiKeys         UserApiKey[]
  auditLogs       AuditLog[]
  creatorProfile  CreatorProfile?
  templateReviews TemplateReview[]
  skillReviews    SkillReview[]
  templateInstalls TemplateInstall[]
  skillInstalls   SkillInstall[]
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@index([email])
  @@index([dodoCustomerId])
}

// SubscriptionTier removed — flat pricing: buy template + $79/mo per Claw

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  
  @@unique([identifier, token])
}

// ─── API KEY MANAGEMENT ─────────────────────────────────

model UserApiKey {
  id          String   @id @default(cuid())
  userId      String
  provider    ApiProvider
  
  // Encrypted with AES-256-GCM. Key derived from ENCRYPTION_MASTER_KEY env var.
  // Format: iv:authTag:ciphertext (all base64)
  encryptedKey String
  
  // Display metadata (NOT the actual key)
  keyHint     String   // e.g., "sk-ant-...7x3Q" (first 7 + last 4 chars)
  label       String?  // User's custom label, e.g. "Production Claude key"
  
  isValid     Boolean  @default(true)  // Set false on auth failure
  lastUsedAt  DateTime?
  lastError   String?  // Last validation error if any
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([userId, provider])
  @@index([userId])
}

enum ApiProvider {
  ANTHROPIC
  OPENAI
  GOOGLE
  OPENROUTER
  OLLAMA
}

// ─── WORKSPACES ─────────────────────────────────────────

model Workspace {
  id          String   @id @default(cuid())
  userId      String
  name        String
  slug        String
  description String?
  
  // Deployment state
  status      WorkspaceStatus @default(DRAFT)
  // deploymentType removed — always cloud
  
  // Container management (cloud deployments only)
  containerId     String?   // Docker container ID
  containerName   String?   // Docker container name (laxclaws-{workspaceId})
  containerHost   String?   // Host machine identifier
  containerPort   Int?      // Dynamic Docker host port for gateway access
  hostPort        Int?      // Mapped host port for health checks and monitoring
  gatewayToken    String?   // Encrypted gateway auth token for platform↔container WebSocket
  lastHealthCheck DateTime?
  healthStatus    HealthStatus @default(UNKNOWN)
  timezone        String?   @default("UTC")
  
  // Channel configuration (encrypted JSON)
  channelConfigEncrypted String?  // Encrypted JSON blob
  
  // Cost tracking
  currentMonthApiCost Float    @default(0)
  apiSpendLimit       Float    @default(50.0) // USD, per month
  costAlertThreshold  Float    @default(0.8)  // Alert at 80% of limit
  costAlertSent       Boolean  @default(false)
  
  // Source template (if purchased from store)
  clawTemplateId String?
  
  // Relations
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  clawTemplate ClawTemplate? @relation(fields: [clawTemplateId], references: [id])
  agents      Agent[]
  connections AgentConnection[]
  activityLogs ActivityLog[]
  deployments  Deployment[]
  toolConnections ToolConnection[]
  customToolConnections CustomToolConnection[]
  snapshots   WorkspaceSnapshot[]
  auditLogs   AuditLog[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([userId, slug])
  @@index([userId])
  @@index([status])
  @@index([containerId])
}

enum WorkspaceStatus {
  DRAFT              // Being configured in builder, not deployed (custom Claws)
  SETUP_INCOMPLETE   // Purchased from store, setup wizard not finished
  DEPLOYING          // Container being created
  RUNNING            // Active and healthy
  PAUSED             // Manually paused by user
  ERROR              // Deployment or runtime error
  STOPPED            // Stopped (billing issue, limit reached)
}

// DeploymentType removed — all deployments are cloud-only

enum HealthStatus {
  HEALTHY
  DEGRADED     // Responding but with errors
  UNHEALTHY    // Not responding
  UNKNOWN      // Not yet checked
}

// ─── AGENTS ─────────────────────────────────────────────

model Agent {
  id            String   @id @default(cuid())
  workspaceId   String
  agentSlug     String   // e.g., "scout", "writer", "critic"
  
  name          String
  roleDescription String?  // Short role description for display (e.g., "Handles lead qualification")
  description   String?  // Longer description for display
  color         String   @default("#5BA1F5") // Hex color for UI
  icon          String?  // Emoji or icon identifier
  
  // Core configuration (these generate the workspace files)
  soulMd        String   @db.Text  // SOUL.md content
  agentsMd      String   @db.Text  // AGENTS.md content
  heartbeatMd   String?  @db.Text  // HEARTBEAT.md content (null = no scheduled tasks)
  toolsMd       String?  @db.Text  // TOOLS.md content
  userMd        String?  @db.Text  // USER.md content (shared across agents typically)
  identityMd    String?  @db.Text  // IDENTITY.md content
  
  // Model configuration
  model         String   @default("anthropic/claude-sonnet-4-6")
  fallbackModel String?  // e.g., "anthropic/claude-haiku-4-5"
  
  // Skills assigned to this agent
  skills        AgentSkill[]
  
  // Canvas positioning (for React Flow)
  positionX     Float    @default(0)
  positionY     Float    @default(0)
  
  // Agent hierarchy
  role          AgentRole  @default(WORKER)
  reportsTo     String?    // Agent ID this reports to (null = top-level Orchestrator)
  maxRetries    Int        @default(3)     // Max revision rounds with Critic
  qualityThreshold Float   @default(8.0)  // Minimum Critic score to pass (1-10)
  
  // Connections
  outgoingConnections AgentConnection[] @relation("SourceAgent")
  incomingConnections AgentConnection[] @relation("TargetAgent")
  
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([workspaceId, agentSlug])
  @@index([workspaceId])
}

model AgentSkill {
  id        String @id @default(cuid())
  agentId   String
  skillId   String
  
  // Per-agent skill configuration overrides (JSON)
  configOverrides String? @db.Text
  
  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)
  skill Skill @relation(fields: [skillId], references: [id], onDelete: Cascade)
  
  @@unique([agentId, skillId])
  @@index([agentId])
}

// ─── AGENT CONNECTIONS (Flow Edges) ─────────────────────

model AgentConnection {
  id            String @id @default(cuid())
  workspaceId   String
  sourceAgentId String
  targetAgentId String
  
  // When does data flow from source to target?
  condition     ConnectionCondition @default(ON_COMPLETE)
  
  // Optional: custom condition expression
  conditionExpr String?  // e.g., "quality_score >= 0.8"
  
  // Edge label displayed in the builder
  label         String?
  
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  sourceAgent Agent     @relation("SourceAgent", fields: [sourceAgentId], references: [id], onDelete: Cascade)
  targetAgent Agent     @relation("TargetAgent", fields: [targetAgentId], references: [id], onDelete: Cascade)
  
  @@index([workspaceId])
  @@index([sourceAgentId])
  @@index([targetAgentId])
}

enum ConnectionCondition {
  ON_COMPLETE     // Always flows after source completes
  ON_APPROVAL     // Flows only if source approves (Critic pattern)
  ON_REJECTION    // Flows only if source rejects (feedback loop)
  ON_SCHEDULE     // Triggered by heartbeat schedule
  ON_HUMAN_APPROVE // Requires human approval before flowing
  CUSTOM          // Uses conditionExpr
}

// ─── SKILLS LIBRARY ─────────────────────────────────────

model Skill {
  id          String @id @default(cuid())
  name        String                        // "Apollo.io Lead Search"
  slug        String @unique                // "apollo-lead-search"
  description String                        // Short description for UI

  // The actual SKILL.md content
  skillMd     String @db.Text

  // Classification (see Architecture Section 21 for full details)
  type        SkillType                     // BUILT_IN, TOOL_SPECIFIC, TOOL_AGNOSTIC, DOMAIN_WORKFLOW, USER_GENERATED
  category    SkillCategory                 // CRM, EMAIL_SENDER, SEARCH, etc.
  icon        String?

  // Which tools this skill works with
  compatibleTools  String[]                 // ["apollo", "zoominfo"] or ["*"] for tool-agnostic

  // Whether this requires a specific tool to be connected
  requiresToolConnection  Boolean @default(false)
  requiredToolCategory    String?           // "CRM", "EMAIL_SENDER", etc.

  // Trust & verification
  isVerified  Boolean @default(false)       // Manually reviewed by Claws team
  isBuiltIn   Boolean @default(false)       // Ships with OpenClaw (web search, files, etc.)
  isCurated   Boolean @default(true)        // Maintained by Claws team
  version     Int     @default(1)           // Incremented when we update the SKILL.md

  // Security
  permissions   String[]                    // ["internet_access", "file_read", "email_send"]
  securityNotes String?

  // Relations
  agentSkills AgentSkill[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([type, category])
  @@index([category])
}

enum SkillType {
  BUILT_IN          // Ships with OpenClaw (web search, files, shell, memory)
  TOOL_SPECIFIC     // Works with a specific API-key tool (Apollo, Instantly, Tavily)
  TOOL_AGNOSTIC     // Works with any tool in a category ("update the CRM")
  DOMAIN_WORKFLOW   // Domain knowledge, not tool-bound (cold email writing, lead scoring)
  USER_GENERATED    // Auto-generated for custom API connections
}

enum SkillCategory {
  CORE              // Built-in (web, files, shell, memory)
  CRM               // Lead/contact/deal management
  EMAIL_SENDER      // Outbound email sequences
  EMAIL_READER      // Inbox monitoring
  LEAD_DATABASE     // Prospect search and enrichment
  ENRICHMENT        // Data enrichment (Clay, Clearbit)
  SOCIAL            // Social media posting and monitoring
  CALENDAR          // Scheduling and availability
  PROJECT_MGMT      // Task and project tracking
  ANALYTICS         // Data and metrics
  SEARCH            // Web search
  FINANCE           // Invoicing, payments, accounting
  TRADING           // Market data, order execution
  CONTENT           // Content creation and management
  COMMUNICATION     // Messaging (Slack, Teams, etc.)
  SECURITY          // CVE scanning, secret detection
  CUSTOM            // User-defined
}

enum AgentRole {
  ORCHESTRATOR   // Manager — delegates, monitors, reports to human
  WORKER         // Executes specific tasks
  CRITIC         // Reviews all outputs for quality
}

// ─── TOOL CONNECTIONS (Integration Layer) ───────────────

model ToolConnection {
  id           String   @id @default(cuid())
  workspaceId  String
  toolSlug     String   // e.g., "apollo", "hubspot", "gmail"

  connectionType ConnectionType
  displayName    String   // "Apollo.io"

  // For API_KEY type
  encryptedApiKey String?  // AES-256-GCM encrypted
  keyHint         String?  // "sk-apo...x7Qq"

  // For OAUTH_COMPOSIO type
  composioConnectionId String?
  composioEntityId     String?

  // Status
  status       ToolConnectionStatus @default(PENDING)
  lastTestedAt DateTime?
  lastError    String?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([workspaceId, toolSlug])
  @@index([workspaceId])
}

enum ConnectionType {
  API_KEY
  OAUTH_COMPOSIO
  CHANNEL_NATIVE
}

enum ToolConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  ERROR
  REVOKED
}

// ─── CLAW TEMPLATES (Store) ─────────────────────────────

model ClawTemplate {
  id          String @id @default(cuid())
  name        String
  slug        String @unique
  tagline     String // Short description for card
  description String @db.Text // Full description for detail page
  
  // Categorization
  category    ClawCategory
  tags        String[]
  
  // Pricing
  isFree      Boolean @default(false)
  price       Float?  // null if free; minimum $19 if community paid; $149/$199/$299 for official
  
  // Creator (null = Official by Claws team)
  creatorId   String?
  creator     CreatorProfile? @relation(fields: [creatorId], references: [id])
  
  // Trust & Review
  trustTier   TrustTier @default(UNREVIEWED)
  reviewStatus ReviewStatus @default(PENDING)
  reviewedAt  DateTime?
  reviewNotes String?
  
  // Display
  agentCount  Int
  previewImage String? // URL to preview image
  featured    Boolean @default(false)
  sortOrder   Int     @default(0)
  isPublished Boolean @default(false)  // Must be explicitly published
  publishedAt DateTime?
  
  // The complete workspace snapshot
  // Contains all agents with their SOUL.md, AGENTS.md, skills, connections
  // Stored as JSON. When installed, this gets unpacked into Agent records.
  workspaceSnapshot String @db.Text // JSON
  
  // Version compatibility
  version            Int     @default(1)       // Template version (creator can update)
  minOpenClawVersion String? // e.g., "2.4.0"
  testedOnVersion    String? // e.g., "2.5.1"
  
  // Cost estimation
  estimatedMonthlyCost String? // e.g., "$40-80" — creator-provided estimate of LLM costs
  
  // Metrics (denormalized)
  installCount Int    @default(0)
  avgRating    Float?
  
  // Relations
  workspaces   Workspace[]
  purchases    Purchase[]
  reviews      TemplateReview[]
  installs     TemplateInstall[]
  sales        MarketplaceSale[]
  
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  
  @@index([category])
  @@index([featured])
  @@index([trustTier])
  @@index([isPublished])
  @@index([creatorId])
  @@index([installCount])
}

enum ClawCategory {
  MONEY_MAKING   // Quant Trader, Freelancer, E-Commerce
  CREATOR        // YouTube, Twitter, Newsletter, Podcast
  BUSINESS_OPS   // B2B Sales, Agency, Founder CoS, SEO
  VERTICAL       // Real Estate, Recruiter, Medical, Law, Home Services
  LIFESTYLE      // Health, Student, Job Hunter, Developer
}

enum TrustTier {
  UNREVIEWED   // Auto-listed, not tested
  SCANNED      // Automated scan passed (skills only, after Layer 1+2)
  VERIFIED     // Human-reviewed, confirmed working
  OFFICIAL     // Built and maintained by Claws team
}

enum ReviewStatus {
  PENDING      // In review queue
  APPROVED     // Passed review → upgraded trust tier
  REJECTED     // Failed review (with reason). Creator can fix and resubmit → resets to PENDING
  FLAGGED      // Reported by users
}

model TemplateReview {
  id             String @id @default(cuid())
  clawTemplateId String
  userId         String
  
  rating         Int      // 1-5
  title          String?
  body           String?  @db.Text
  verifiedInstall Boolean @default(false) // True if user has a TemplateInstall record
  
  template ClawTemplate @relation(fields: [clawTemplateId], references: [id], onDelete: Cascade)
  user     User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([clawTemplateId, userId])  // One review per user per template
  @@index([clawTemplateId])
}

model TemplateInstall {
  id         String @id @default(cuid())
  templateId String
  userId     String
  
  template   ClawTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt  DateTime @default(now())
  
  @@unique([templateId, userId])  // One install record per user per template
  @@index([templateId])
  @@index([createdAt])  // For "trending" queries (installs in last 7 days)
}

// ─── CREATOR PROFILES ──────────────────────────────────

model CreatorProfile {
  id          String   @id @default(cuid())
  userId      String   @unique
  displayName String
  bio         String?  @db.Text
  avatarUrl   String?
  websiteUrl  String?
  twitterUrl  String?
  githubUrl   String?
  
  isActive    Boolean  @default(true)  // Soft-delete: false when creator deletes account
  agreedToTermsAt DateTime
  
  // Dodo payout
  dodoBeneficiaryId String?  // Dodo Payments beneficiary ID for payouts
  
  // Stats (denormalized, updated via triggers/cron)
  totalInstalls  Int   @default(0)
  totalTemplates Int   @default(0)
  totalSkills    Int   @default(0)
  averageRating  Float @default(0)
  
  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  templates  ClawTemplate[]
  skills     MarketplaceSkill[]
  sales      MarketplaceSale[]
  
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

// ─── MARKETPLACE SKILLS ────────────────────────────────

model MarketplaceSkill {
  id           String   @id @default(cuid())
  
  // Identity
  slug         String   @unique
  name         String
  description  String   @db.Text  // "When to use / not use" — critical for agent skill matching
  category     String              // ClawHub-compatible category (see SkillCategory reference)
  tags         String[]
  emoji        String?
  
  // Content
  skillMd      String   @db.Text  // The SKILL.md content
  requiredBins String[]            // e.g., ["curl", "jq", "gh"]
  requiredEnvVars String[]         // e.g., ["HUBSPOT_API_KEY"]
  
  // Creator (null = Official)
  creatorId    String?
  creator      CreatorProfile? @relation(fields: [creatorId], references: [id])
  
  // Trust & Review
  trustTier    TrustTier    @default(UNREVIEWED)
  reviewStatus ReviewStatus @default(PENDING)
  reviewedAt   DateTime?
  reviewNotes  String?
  
  // Vetting pipeline results (3 layers)
  autoScanPassed   Boolean?          // Layer 1: pattern matching
  autoScanReport   String?  @db.Text // JSON: findings from auto scan
  sandboxPassed    Boolean?          // Layer 2: sandbox test
  sandboxReport    String?  @db.Text // JSON: network calls, file access observed
  
  // Marketplace
  isFree       Boolean @default(true)
  price        Float?  // minimum $5 if paid
  installCount Int     @default(0)
  isPublished  Boolean @default(false)
  publishedAt  DateTime?
  avgRating    Float?
  
  // Version
  version            Int     @default(1)
  minOpenClawVersion String?
  
  // Relations
  reviews      SkillReview[]
  installs     SkillInstall[]
  sales        MarketplaceSale[]
  
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  @@index([category])
  @@index([trustTier])
  @@index([isPublished])
  @@index([creatorId])
  @@index([installCount])
}

// Skill categories — aligned with ClawHub for ecosystem compatibility
// Reference list: Communication, CRM, Data, Developer, Email, File Management,
// Finance, Marketing, Productivity, Search, Security, Social, System, Web

model SkillReview {
  id       String @id @default(cuid())
  skillId  String
  userId   String
  
  rating   Int      // 1-5
  title    String?
  body     String?  @db.Text
  verifiedInstall Boolean @default(false)
  
  skill    MarketplaceSkill @relation(fields: [skillId], references: [id], onDelete: Cascade)
  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([skillId, userId])
  @@index([skillId])
}

model SkillInstall {
  id      String @id @default(cuid())
  skillId String
  userId  String
  
  skill   MarketplaceSkill @relation(fields: [skillId], references: [id], onDelete: Cascade)
  user    User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt DateTime @default(now())
  
  @@unique([skillId, userId])
  @@index([skillId])
  @@index([createdAt])
}

// ─── MARKETPLACE SALES & PAYOUTS ───────────────────────

model MarketplaceSale {
  id           String   @id @default(cuid())
  
  // What was sold
  templateId   String?
  skillId      String?
  template     ClawTemplate?    @relation(fields: [templateId], references: [id])
  skill        MarketplaceSkill? @relation(fields: [skillId], references: [id])
  
  // Who
  buyerId      String
  creatorId    String
  creator      CreatorProfile @relation(fields: [creatorId], references: [id])
  
  // Money
  amount        Float     // Sale price
  processingFee Float     // ~3-5% Dodo fee
  creatorPayout Float     // amount - processingFee
  
  // Payout tracking
  payoutStatus  PayoutStatus @default(PENDING)
  payoutHeldUntil DateTime? // 7-day hold before release
  payoutBatchId String?     // Dodo batch payout reference
  paidAt        DateTime?
  
  // Dodo reference
  dodoPaymentId String? @unique
  
  createdAt    DateTime @default(now())
  
  @@index([creatorId])
  @@index([payoutStatus])
  @@index([createdAt])
}

enum PayoutStatus {
  PENDING      // Sale made, in 7-day hold period
  RELEASABLE   // Hold period passed, ready for next batch
  PROCESSING   // Included in a Dodo payout batch
  PAID         // Creator received funds
  FAILED       // Payout failed
  REFUNDED     // Sale was refunded, payout cancelled
}

// ─── REPORTS (User-submitted) ──────────────────────────

model Report {
  id          String @id @default(cuid())
  reporterId  String // User who filed the report
  
  // What's being reported (one of these)
  templateId  String?
  skillId     String?
  reviewId    String?  // Can report reviews too
  
  reason      ReportReason
  details     String?  @db.Text
  
  // Resolution
  resolved    Boolean  @default(false)
  resolvedAt  DateTime?
  resolution  String?  // Admin notes on resolution
  
  createdAt   DateTime @default(now())
  
  @@index([resolved])
}

enum ReportReason {
  MALICIOUS          // Contains malicious code or behavior
  MISLEADING         // Description doesn't match actual behavior
  COPYRIGHT          // Copies another template/skill
  SPAM               // Low effort, promotional
  INAPPROPRIATE      // Offensive content in prompts
  BROKEN             // Doesn't work as described
  NAME_CONFLICT      // Conflicts with official template name
}

// ─── OPENCLAW VERSION MANAGEMENT ───────────────────────

model OpenClawVersion {
  id        String   @id @default(cuid())
  version   String   @unique  // Semver, e.g., "2.5.1"
  
  // Status
  isStable  Boolean  @default(false) // We've tested it, safe to run
  isLatest  Boolean  @default(false) // Most recent release from OpenClaw
  isSecurityPatch Boolean @default(false) // Forces update within 48 hours
  
  // Image
  dockerImage String  // ghcr.io/laxcorp/openclaw-runtime:2.5.1
  
  // Compatibility notes
  releaseNotes    String? @db.Text
  breakingChanges String? @db.Text
  
  // Timing
  releasedAt DateTime   // When OpenClaw released it
  stableAt   DateTime?  // When we marked it stable
  
  createdAt  DateTime @default(now())
}

// ─── PURCHASES & BILLING ────────────────────────────────

model Purchase {
  id              String @id @default(cuid())
  userId          String
  clawTemplateId  String
  workspaceId     String? // Created workspace from this purchase
  
  // Payment
  amountPaid      Float
  currency        String @default("usd")
  dodoPaymentId String @unique
  dodoBusinessId String?
  
  // Platform subscription
  subscriptionId  String? // Dodo Payments subscription ($79/mo per Claw)
  subscriptionStatus SubscriptionStatus?
  
  status          PurchaseStatus @default(COMPLETED)
  refundedAt      DateTime?
  
  user User          @relation(fields: [userId], references: [id])
  clawTemplate ClawTemplate @relation(fields: [clawTemplateId], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([userId])
  @@index([clawTemplateId])
  @@index([dodoPaymentId])
}

enum PurchaseStatus {
  PENDING
  COMPLETED
  REFUNDED
  FAILED
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  UNPAID
}

// ─── DEPLOYMENTS ────────────────────────────────────────

model Deployment {
  id          String @id @default(cuid())
  workspaceId String
  
  // What was deployed
  configSnapshot String @db.Text // JSON snapshot of workspace config at deploy time
  version        Int              // Incrementing version number
  
  // Container info
  containerId    String?
  containerImage String  @default("ghcr.io/laxcorp/openclaw-runtime:latest")
  containerHost  String?
  
  // Status
  status         DeploymentStatus @default(PENDING)
  errorMessage   String?
  
  // Timing
  startedAt      DateTime @default(now())
  completedAt    DateTime?
  
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  @@index([workspaceId])
  @@index([status])
}

enum DeploymentStatus {
  PENDING
  BUILDING       // Generating workspace files
  PROVISIONING   // Creating container
  CONFIGURING    // Setting up channels + auth
  HEALTH_CHECK   // Verifying agent responds
  COMPLETED
  FAILED
  ROLLED_BACK
}

// ─── ACTIVITY LOGS ──────────────────────────────────────

model ActivityLog {
  id          String @id @default(cuid())
  workspaceId String
  
  agentName   String?  // null for system events
  agentSlug   String?
  action      String   // Human-readable description
  actionType  ActivityType
  
  // Structured data about the action
  metadata    String?  @db.Text // JSON
  
  // Cost tracking per action
  tokenCount  Int?     // Total tokens used
  apiCost     Float?   // Estimated cost in USD
  
  timestamp   DateTime @default(now())
  
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  @@index([workspaceId, timestamp])
  @@index([workspaceId, agentSlug])
  @@index([actionType])
}

enum ActivityType {
  HEARTBEAT       // Scheduled check
  TASK_START      // Agent started a task
  TASK_COMPLETE   // Agent completed a task
  TASK_FAILED     // Agent task failed
  REVIEW_PASS     // Critic approved
  REVIEW_REJECT   // Critic rejected
  HUMAN_REQUEST   // Waiting for human input
  HUMAN_APPROVE   // Human approved
  HUMAN_REJECT    // Human rejected
  MESSAGE_SENT    // Agent sent a message to user
  MESSAGE_RECEIVED // Agent received message from user
  SKILL_INVOKED   // Agent used a skill/tool
  ERROR           // Runtime error
  SYSTEM          // System event (deploy, restart, etc.)
  COST_ALERT      // Spending threshold reached
  
  // Trading-specific
  TRADE_SIGNAL      // Signal detected by Market Scanner
  TRADE_RECOMMENDED // Full trade thesis presented
  TRADE_EXECUTED    // Trade placed (human-approved or autonomous)
  TRADE_CLOSED      // Position closed
  TRADE_BLOCKED     // Blocked by risk gate
  CIRCUIT_BREAKER   // Daily loss limit or other circuit breaker triggered
}

// ─── AUDIT LOG ──────────────────────────────────────────

model AuditLog {
  id          String @id @default(cuid())
  userId      String?
  workspaceId String?
  
  action      AuditAction
  resource    String    // e.g., "workspace", "agent", "deployment"
  resourceId  String    // ID of the affected resource
  
  // What changed
  before      String?   @db.Text // JSON snapshot before change
  after       String?   @db.Text // JSON snapshot after change
  
  // Request context
  ipAddress   String?
  userAgent   String?
  
  timestamp   DateTime  @default(now())
  
  user      User?      @relation(fields: [userId], references: [id])
  workspace Workspace? @relation(fields: [workspaceId], references: [id])
  
  @@index([userId])
  @@index([workspaceId])
  @@index([action])
  @@index([timestamp])
}

enum AuditAction {
  // Auth
  USER_LOGIN
  USER_LOGOUT
  USER_REGISTER
  PASSWORD_CHANGE
  API_KEY_ADDED
  API_KEY_REMOVED
  
  // Workspace
  WORKSPACE_CREATED
  WORKSPACE_UPDATED
  WORKSPACE_DELETED
  
  // Agents
  AGENT_CREATED
  AGENT_UPDATED
  AGENT_DELETED
  AGENT_SOUL_UPDATED
  AGENT_SKILLS_CHANGED
  
  // Deployment
  DEPLOYMENT_STARTED
  DEPLOYMENT_COMPLETED
  DEPLOYMENT_FAILED
  DEPLOYMENT_ROLLED_BACK
  CONTAINER_STARTED
  CONTAINER_STOPPED
  CONTAINER_RESTARTED
  
  // Billing
  PURCHASE_MADE
  SUBSCRIPTION_STARTED
  SUBSCRIPTION_CANCELED
  PAYMENT_FAILED
  
  // Admin
  TEMPLATE_CREATED
  TEMPLATE_UPDATED
  SKILL_VERIFIED
  USER_SUSPENDED
  
  // Marketplace
  TEMPLATE_PUBLISHED
  TEMPLATE_UNPUBLISHED
  TEMPLATE_REVIEW_APPROVED
  TEMPLATE_REVIEW_REJECTED
  SKILL_PUBLISHED
  SKILL_UNPUBLISHED
  SKILL_REVIEW_APPROVED
  SKILL_REVIEW_REJECTED
  SKILL_INSTALLED
  CREATOR_ENROLLED
  CREATOR_PAYOUT_SENT
  REPORT_FILED
  REPORT_RESOLVED
  VERSION_PROMOTED_STABLE
  VERSION_FORCE_UPDATE
  
  // Trading (Market Intelligence Claw specific)
  TRADE_RECOMMENDED
  TRADE_APPROVED_BY_HUMAN
  TRADE_AUTO_EXECUTED
  TRADE_REJECTED_BY_HUMAN
  TRADE_LIMIT_REACHED
  TRADE_CIRCUIT_BREAKER_TRIGGERED
}
```

---

## 4. Authentication & Authorization

### Auth Flow (NextAuth.js v5)

```
Providers:
  - GitHub OAuth (primary for developers)
  - Google OAuth (primary for business users)
  - Email magic link (fallback)
  
Session strategy: JWT (stateless, works with Vercel Edge)
Token rotation: Enabled, 30-day max session
CSRF protection: Built-in via NextAuth
```

### Authorization Model

```typescript
// lib/auth/permissions.ts

type Permission = 
  | 'workspace:create'
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'workspace:deploy'
  | 'agent:create'
  | 'agent:update'
  | 'agent:delete'
  | 'template:publish'   // Any enrolled creator
  | 'skill:publish'      // Any enrolled creator
  | 'template:create'    // Admin only
  | 'template:update'    // Admin only
  | 'review:approve'     // Admin only
  | 'review:reject'      // Admin only
  | 'skill:verify'       // Admin only

// No tiers — all paying users get all permissions
const USER_PERMISSIONS: Permission[] = [
  'workspace:create', 'workspace:read', 'workspace:update',
  'workspace:deploy', 'workspace:delete',
  'agent:create', 'agent:update', 'agent:delete',
]

// Creators get user permissions plus publishing
const CREATOR_PERMISSIONS: Permission[] = [
  ...USER_PERMISSIONS,
  'template:publish', 'skill:publish',
]

const PLATFORM_LIMITS = {
  maxWorkspacesPerUser: 20,
  maxAgentsPerWorkspace: 50,
  trialDays: 3,                   // 3-day trial on first deploy
  monthlyApiSpendLimit: 500,
  platformFeePerClaw: 79,         // $79/mo per running Claw
  minCommunityTemplatePrice: 19,  // $19 minimum for paid community templates
  minCommunitySkillPrice: 5,      // $5 minimum for paid community skills
  payoutHoldDays: 7,              // 7-day hold before creator payout release
}
```

### Middleware (Edge)

```typescript
// middleware.ts
// Runs on Vercel Edge before every request

const publicPaths = ['/', '/store', '/store/*', '/creator/*', '/pricing', '/api/auth/*', '/api/dodo/webhook', '/api/marketplace/templates', '/api/marketplace/templates/*', '/api/marketplace/skills', '/api/marketplace/skills/*']
const authPaths = ['/builder/*', '/dashboard/*', '/deploy/*', '/settings/*', '/publish/*', '/api/*']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Public paths: allow
  if (publicPaths.some(p => matchPath(pathname, p))) return NextResponse.next()
  
  // Auth paths: verify JWT
  const token = await getToken({ req: request })
  if (!token) return NextResponse.redirect(new URL('/api/auth/signin', request.url))
  
  // Rate limiting (via Upstash Redis)
  const rateLimit = await rateLimiter.limit(token.sub)
  if (!rateLimit.success) return new NextResponse('Too Many Requests', { status: 429 })
  
  return NextResponse.next()
}
```

---

## 5. API Design

### Route Structure

All API routes are in `/src/app/api/`. Authentication is enforced via middleware. Workspace ownership is verified on every request.

```
/api/
├── auth/[...nextauth]/      # NextAuth handlers
│
├── workspaces/
│   ├── GET    /             # List user's workspaces
│   ├── POST   /             # Create workspace (from scratch or template)
│   ├── GET    /[id]         # Get workspace details
│   ├── PATCH  /[id]         # Update workspace settings
│   ├── DELETE /[id]         # Delete workspace + container
│   └── POST   /[id]/duplicate  # Clone a workspace
│
├── agents/
│   ├── GET    /[workspaceId]         # List agents in workspace
│   ├── POST   /[workspaceId]         # Create agent
│   ├── PATCH  /[workspaceId]/[id]    # Update agent (SOUL.md, model, etc.)
│   ├── DELETE /[workspaceId]/[id]    # Delete agent
│   └── PATCH  /[workspaceId]/[id]/position  # Update canvas position
│
├── connections/
│   ├── GET    /[workspaceId]         # List connections
│   ├── POST   /[workspaceId]         # Create connection
│   ├── PATCH  /[workspaceId]/[id]    # Update condition
│   └── DELETE /[workspaceId]/[id]    # Delete connection
│
├── deploy/
│   ├── POST   /[workspaceId]/cloud   # Deploy to cloud
│   │   ├── POST   /[workspaceId]/stop    # Stop container
│   ├── POST   /[workspaceId]/restart # Restart container
│   ├── GET    /[workspaceId]/health  # Container health check
│   └── GET    /[workspaceId]/logs    # Container logs (paginated)
│
├── activity/
│   └── GET    /[workspaceId]/stream  # SSE endpoint for live activity
│
├── skills/
│   ├── GET    /                      # List all available skills
│   ├── GET    /[slug]                # Get skill details
│   └── POST   /custom                # Create custom skill (PRO+)
│
├── templates/
│   ├── GET    /                      # List store templates (official only — legacy, redirects to marketplace)
│   ├── GET    /[slug]                # Get template details
│   └── POST   /[slug]/purchase       # Purchase template (creates workspace)
│
├── marketplace/
│   ├── templates/
│   │   ├── GET    /                  # List all published templates (filters, search, sort, pagination)
│   │   │                             # Query params: category, trustTier, isFree, sort, search, cursor, limit
│   │   ├── GET    /[slug]            # Template detail (includes creator, reviews, install count)
│   │   ├── POST   /                  # Publish template (creator must be enrolled)
│   │   │                             # Validates: name not conflicting with Official, skills exist, min price $19
│   │   ├── PUT    /[slug]            # Update published template (creator only, resets reviewStatus to PENDING)
│   │   ├── DELETE /[slug]            # Unpublish (creator only — existing installs keep working)
│   │   ├── GET    /[slug]/reviews    # List reviews (paginated, 10 per page, newest first)
│   │   ├── POST   /[slug]/reviews    # Submit review (verified install required, one per user)
│   │   └── POST   /[slug]/report     # Report template
│   │
│   └── skills/
│       ├── GET    /                  # List all published skills (filters, search, sort, pagination)
│       ├── GET    /[slug]            # Skill detail (includes SKILL.md preview, creator, reviews)
│       ├── POST   /                  # Publish skill (triggers Layer 1 auto-scan immediately)
│       │                             # If scan passes: listed as UNREVIEWED. If fails: rejected with reason.
│       ├── PUT    /[slug]            # Update skill (creator only, re-triggers scan)
│       ├── DELETE /[slug]            # Unpublish
│       ├── POST   /[slug]/install    # Install skill to workspace (copies SKILL.md, updates openclaw.json)
│       ├── GET    /[slug]/reviews    # List reviews
│       ├── POST   /[slug]/reviews    # Submit review
│       └── POST   /[slug]/report     # Report skill
│
├── creator/
│   ├── POST   /enroll               # Opt-in: fill profile + agree to terms → instant CreatorProfile
│   ├── GET    /profile              # Get own creator profile
│   ├── PUT    /profile              # Update profile (name, bio, avatar, social links)
│   ├── GET    /[id]                 # Public creator profile (anyone can view)
│   ├── GET    /earnings             # Earnings dashboard (sales, pending payouts, paid payouts)
│   ├── GET    /templates            # My published templates with stats
│   ├── GET    /skills               # My published skills with stats
│   └── GET    /payout-settings      # Dodo beneficiary status
│
├── dodo/
│   ├── POST   /checkout              # Create Dodo Payments checkout session
│   ├── POST   /portal                # Create billing portal session
│   └── POST   /webhook               # Dodo Payments webhook handler
│
├── api-keys/
│   ├── GET    /                      # List user's API keys (hints only)
│   ├── POST   /                      # Add API key (encrypts before storing)
│   ├── DELETE /[id]                   # Remove API key
│   └── POST   /[id]/validate         # Test if key is valid
│
└── admin/                             # Admin-only routes
    ├── GET    /stats                  # Platform metrics
    ├── review-queue/
    │   ├── GET    /templates          # Templates pending review
    │   ├── GET    /skills             # Skills pending review
    │   ├── POST   /templates/[id]/approve  # Approve → upgrade to VERIFIED
    │   ├── POST   /templates/[id]/reject   # Reject with reason
    │   ├── POST   /skills/[id]/approve     # Approve → upgrade to VERIFIED
    │   └── POST   /skills/[id]/reject      # Reject with reason
    ├── versions/
    │   ├── GET    /stable             # Current stable OpenClaw version
    │   ├── GET    /available          # All available versions
    │   ├── POST   /promote            # Mark a version as stable
    │   └── POST   /force-update       # Force security patch (stops + redeploys all containers)
    ├── reports/
    │   ├── GET    /                    # Unresolved reports
    │   └── POST   /[id]/resolve       # Resolve report
    ├── PATCH  /templates/[id]         # Update template
    └── PATCH  /skills/[id]/verify     # Verify a skill
```

### API Response Format

```typescript
// Consistent response envelope for all API routes

// Success
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-03-15T10:30:00Z",
    "requestId": "req_abc123"
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "WORKSPACE_LIMIT_REACHED",
    "message": "Maximum 20 workspaces per account. Contact support for higher limits.",
    "statusCode": 403
  },
  "meta": {
    "timestamp": "2026-03-15T10:30:00Z",
    "requestId": "req_abc123"
  }
}
```

### Ownership Verification Pattern

```typescript
// lib/api/ownership.ts
// Used by EVERY workspace-scoped route

async function verifyWorkspaceOwnership(
  workspaceId: string, 
  userId: string
): Promise<Workspace> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  })
  
  if (!workspace) throw new ApiError('WORKSPACE_NOT_FOUND', 404)
  if (workspace.userId !== userId) throw new ApiError('FORBIDDEN', 403)
  
  return workspace
}
```

---

## 6. Security Architecture

### Encryption

```
API Keys (User's Claude/OpenAI keys):
  - Algorithm: AES-256-GCM
  - Key derivation: HKDF from ENCRYPTION_MASTER_KEY env var
  - Storage format: base64(iv):base64(authTag):base64(ciphertext)
  - Master key rotation: Supported via key versioning (v1:, v2: prefix)
  - NEVER logged, NEVER returned in API responses (only keyHint)
  - Decrypted ONLY inside container at deployment time

Channel Configs (WhatsApp QR sessions, Teams tokens):
  - Same AES-256-GCM encryption
  - Additional: encrypted at rest in S3 for backups

  - Generated zip contains API key placeholders, NOT actual keys
  - User must manually add their keys after download
  - Export zip is signed with HMAC-SHA256 for integrity verification
```

### Container Isolation

```
Each customer container:
  - Runs as non-root user (UID 1001)
  - Persistent volume at /home/node/.openclaw (agent writes memory, sessions)
  - No host network access (bridge network with egress-only firewall rules)
  - CPU limit: 0.5 cores (prevents crypto mining)
  - Memory limit: 1Gi (prevents memory bombs)
  - PID limit: 100 (prevents fork bombs)
  - No inter-container communication (network isolation)
  - Automatic restart on crash (max 5 restarts in 10 minutes, then alert)
  - Container lifetime: max 30 days, then forced rebuild (prevents drift)
```

### Rate Limiting

```
API Routes:
  - Auth endpoints: 10 req/minute per IP
  - Workspace CRUD: 60 req/minute per user
  - Agent updates: 120 req/minute per user (builder saves frequently)
  - Deploy: 5 req/minute per user
  - Activity stream: 1 SSE connection per workspace (multiplexed)
  - Export: 3 req/hour per user
  
  Implementation: Upstash Redis sliding window
```

### Input Validation

```
Every API route validates input with Zod schemas.
No raw user input reaches the database or container configs.

SOUL.md / AGENTS.md content:
  - Max length: 50,000 characters per field
  - Sanitized: No executable code blocks (```bash, ```sh) that could 
    be interpreted as shell commands by OpenClaw
  - Scanned: Regex check for common prompt injection patterns
  - Note: These are LLM prompts, so we can't fully sanitize without
    breaking functionality. The container isolation is the real defense.

Workspace names / slugs:
  - Alphanumeric + hyphens only
  - Max 64 characters
  - Sanitized against XSS
```

### OWASP Top 10 for Agentic Applications — Mitigations

```
ASI01 (Agent Goal Hijack):
  - Container isolation prevents lateral movement
  - Skill allowlist per agent (can't discover/install new skills at runtime)
  - Human-in-the-loop for all irreversible actions (configurable)

ASI02 (Tool Misuse):
  - Per-agent skill permissions explicitly defined in builder
  - Read-only vs. read-write skill modes
  - No agent can modify its own SOUL.md or AGENTS.md at runtime

ASI03 (Knowledge Poisoning):
  - Memory files are append-only from agent perspective
  - Memory audit: all memory writes logged in ActivityLog
  - Memory reset available from dashboard

ASI06 (Memory Poisoning):
  - Each agent's memory is isolated (separate workspace dirs)
  - Cross-agent communication only through defined connections
  - No shared mutable state between agents

ASI09 (Uncontrolled Autonomy):
  - API spend limits enforced at container level
  - Heartbeat frequency limits (minimum 5 minutes between runs)
  - Max API calls per heartbeat (configurable, default 20)
  - Kill switch: "Pause all" button instantly stops container
```

---

## 7. OpenClaw Integration Layer

### How Claws ↔ OpenClaw Works (Validated March 2026)

```
Claws Platform (Next.js)              OpenClaw Runtime (Docker Container)
┌─────────────────────────┐              ┌──────────────────────────────────┐
│ User buys Claw template │              │ /home/node/.openclaw/            │
│ Configures in Builder   │              │ ├── openclaw.json  ← Config     │
│ Connects tools          │  generator   │ ├── .env           ← API keys   │
│ Clicks Deploy           │──────────────│ ├── workspace-orchestrator/      │
│                         │  TS → files  │ │   ├── SOUL.md                  │
│ DB: Workspace, Agents,  │              │ │   ├── AGENTS.md                │
│     ToolConnections,    │              │ │   ├── USER.md                  │
│     Skills              │              │ │   ├── IDENTITY.md              │
│                         │              │ │   ├── TOOLS.md                 │
│                         │              │ │   ├── HEARTBEAT.md             │
│                         │              │ │   ├── BOOT.md                  │
│                         │              │ │   ├── memory/                  │
│                         │              │ │   └── skills/                  │
│                         │              │ ├── workspace-worker-1/          │
│                         │              │ │   └── ... (same flat structure)│
│                         │              │ ├── workspace-critic/            │
│                         │              │ │   └── ...                      │
│                         │              │ └── cron/jobs.json               │
│                         │              │                                  │
│ Dashboard ◄─── WebSocket ───── Gateway ws://0.0.0.0:18789               │
│ (SSE to browser)        │              │ Health: /healthz + /readyz       │
└─────────────────────────┘              └──────────────────────────────────┘
```

### Key Runtime Facts (from codebase audit)

1. **Each agent gets its own flat workspace directory** — `workspace-{agentId}/` containing SOUL.md, AGENTS.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, BOOT.md, memory/, skills/
2. **AGENTS.md is per-agent operating instructions** — NOT multi-agent definitions. It's the agent's "operating system" (boot sequence, memory rules, safety, tool usage).
3. **Multi-agent defined in `openclaw.json`** — `agents.list[]` with one entry per agent, each pointing to its workspace directory
4. **Orchestrator→Worker uses `sessions_spawn`** — NOT `sessions_send`. The Orchestrator spawns Workers as subagents; results flow back via announce chain automatically. `sessions_send` is peer-to-peer between depth-0 agents only.
5. **No `reportsTo` concept** — hierarchy is implicit via spawn depth (0=main, 1=orchestrator, 2=leaf)
6. **Workspace .md files have ZERO validation** — any UTF-8 under 2MB works. Missing files get `[MISSING]` placeholder.
7. **`openclaw.json` has STRICT Zod validation** — `.strict()` objects, unknown keys cause failure. `agents.list[].id` is the only required field per agent.
8. **Skills loaded on-demand** — only the catalog (`<available_skills>` XML) is in system prompt. Full SKILL.md read by agent via `read` tool when needed.
9. **~55 bundled skills come free** — weather, github, etc. We only generate skills for domain-specific tools.
10. **Config hot-reload** — editing openclaw.json in the volume auto-applies without restart.

### Generator Output Structure

```typescript
// lib/openclaw/generator.ts

interface GeneratedWorkspace {
  'openclaw.json': string;       // Gateway + agent list config (STRICT Zod validation)
  '.env': string;                // API keys, channel tokens (dotenv format)
  workspaces: Record<string, AgentWorkspaceFiles>;  // Per-agent flat directories
  'cron/jobs.json': string;      // Scheduled tasks
  gatewayToken: string;          // For platform↔container monitoring
}

interface AgentWorkspaceFiles {
  'SOUL.md': string;             // Agent identity & personality
  'AGENTS.md': string;           // Operating instructions (role-specific)
  'USER.md': string;             // Human's profile/preferences
  'IDENTITY.md': string;         // Agent identity card
  'TOOLS.md': string;            // Environment notes (connected tools)
  'HEARTBEAT.md': string;        // Periodic task checklist (Orchestrator only)
  'BOOT.md': string;             // Startup hook
  skills: Record<string, { 'SKILL.md': string }>;  // Tool-specific skills
}
```

### openclaw.json Structure

```json5
{
  "gateway": {
    "mode": "local",
    "bind": "lan",        // Required for Docker (binds 0.0.0.0)
    "port": 18789
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-6",
      "heartbeat": { "every": "30m" },  // Orchestrator heartbeat interval
      "subagents": {
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 8  // Increased for Claws with 6+ Workers
      }
    },
    "list": [
      {
        "id": "orchestrator-id",
        "name": "Trade Commander",
        "default": true,
        "workspace": "/home/node/.openclaw/workspace-orchestrator-id",
        "model": "anthropic/claude-haiku-4-5-20251001",
        "subagents": {
          "allowAgents": ["worker-1", "worker-2", "critic"]
        },
        "skills": ["tavily-search"]
      },
      {
        "id": "worker-1",
        "name": "Market Scanner",
        "workspace": "/home/node/.openclaw/workspace-worker-1",
        "model": "anthropic/claude-sonnet-4-6",
        "skills": ["binance-api", "tavily-search"]
      },
      {
        "id": "critic",
        "name": "Trade Thesis Reviewer",
        "workspace": "/home/node/.openclaw/workspace-critic",
        "model": "anthropic/claude-opus-4-6"
      }
    ]
  },
  "bindings": [
    { "agentId": "orchestrator-id", "match": { "channel": "*" } }
  ],
  "channels": {
    "telegram": { "allowFrom": ["user123"], "groups": { "*": { "requireMention": true } } },
    "discord": { "guilds": { "*": { "requireMention": true } } }
  },
  "skills": {
    "entries": {
      "binance-api": { "enabled": true, "env": { "BINANCE_API_KEY": "..." } },
      "tavily-search": { "enabled": true, "env": { "TAVILY_API_KEY": "..." } }
    }
  }
}
```

### Model String Mapping

OpenClaw requires `provider/model-id` format:

| Our DB Value | OpenClaw Model String |
|---|---|
| `HAIKU_4_5` | `anthropic/claude-haiku-4-5-20251001` |
| `SONNET_4_6` | `anthropic/claude-sonnet-4-6` |
| `OPUS_4_6` | `anthropic/claude-opus-4-6` |
| `GPT_4O` | `openai/gpt-4o` |
| `GEMINI_2_5_PRO` | `google/gemini-2.5-pro` |

### File Generation Rules

- **SOUL.md** — From `agent.soulMd` in DB. If empty, role-specific template (Orchestrator: delegation rules, Worker: execution focus, Critic: review criteria with quality threshold).
- **AGENTS.md** — Role-specific operating instructions. Orchestrator gets `sessions_spawn` delegation rules listing all Workers and Critic by agentId. Workers get task execution procedures. Critic gets review format.
- **USER.md** — Pre-filled from onboarding data (name, timezone, preferences).
- **IDENTITY.md** — Agent name, role, emoji.
- **TOOLS.md** — Environment notes listing connected tools. Replaces our planned CONNECTED_TOOLS.md (which does not exist in OpenClaw). Credentials are NOT in this file — they go in `openclaw.json` `skills.entries`.
- **HEARTBEAT.md** — Task checklist for Orchestrator only. Workers get empty heartbeat. The gateway's built-in heartbeat runner prompts the agent to read this file.
- **BOOT.md** — Startup verification script for Orchestrator. Workers get empty boot.
- **Skills** — One `skills/{slug}/SKILL.md` per assigned skill. YAML frontmatter (name, description, metadata.openclaw.emoji, metadata.openclaw.requires.bins) + markdown body with instructions.
- **Cron** — `cron/jobs.json` for additional scheduled tasks beyond the heartbeat interval. Separate system from HEARTBEAT.md.
- **.env** — API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.), channel tokens (TELEGRAM_BOT_TOKEN, etc.), OPENCLAW_GATEWAY_TOKEN, TZ.

### What We Do NOT Generate

- **BOOTSTRAP.md** — OpenClaw's first-run onboarding. We skip it (our setup wizard handles onboarding).
- **MEMORY.md** — Agent-created at runtime. We ensure the `memory/` directory exists with write permissions.
- **Bundled skills** — ~55 skills ship with OpenClaw (weather, github, etc.). We only generate skills for user-connected tools not already bundled.

### Marketplace Skill Installation (Hot-Add to Running Container)

When a user installs a MarketplaceSkill into a running workspace:

```typescript
// POST /api/marketplace/skills/[slug]/install
// 1. Validate: user owns target workspace, skill is published, scan passed
// 2. Copy SKILL.md content to container filesystem
// 3. Update openclaw.json skills.entries
// 4. Gateway auto-reloads config (hot-reload, no restart needed)

async function installSkillToWorkspace(skillSlug: string, workspaceId: string) {
  const skill = await prisma.marketplaceSkill.findUnique({ where: { slug: skillSlug } })
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  
  // 1. Create skill directory in container volume
  //    Path: /home/node/.openclaw/{agentDir}/skills/{skill.slug}/SKILL.md
  //    Use Docker exec to write file to mounted volume
  const containerName = workspace.containerName
  const targetAgents = getAgentsWithSkillAccess(workspaceId) // Determines which agents get this skill
  
  for (const agent of targetAgents) {
    const skillPath = `/home/node/.openclaw/${agent.workspaceDir}/skills/${skill.slug}/SKILL.md`
    await dockerExec(containerName, `mkdir -p $(dirname ${skillPath})`)
    await dockerWriteFile(containerName, skillPath, skill.skillMd)
  }
  
  // 2. Update openclaw.json skills.entries with new skill
  //    Add env vars the skill needs (user must have provided these)
  const configPath = `/home/node/.openclaw/openclaw.json`
  const config = await dockerReadJson(containerName, configPath)
  config.skills.entries[skill.slug] = {
    enabled: true,
    env: buildEnvFromRequiredVars(skill.requiredEnvVars, workspace)
  }
  await dockerWriteJson(containerName, configPath, config)
  
  // 3. Gateway auto-detects config change, reloads skills catalog
  //    No container restart needed (OpenClaw hot-reloads openclaw.json)
  
  // 4. Record install
  await prisma.skillInstall.create({
    data: { skillId: skill.id, userId: workspace.userId }
  })
  
  // 5. Update install count
  await prisma.marketplaceSkill.update({
    where: { id: skill.id },
    data: { installCount: { increment: 1 } }
  })
}
```

### Community Template Update Flow

When a creator publishes an update to their template:

```
1. Creator edits their Claw in builder → clicks "Publish Update"
2. New workspaceSnapshot captured (v2 of the template)
3. ClawTemplate.version incremented (1 → 2)
4. ClawTemplate.reviewStatus reset to PENDING (queued for re-review)
5. Existing buyers' workspaces are NOT auto-updated
6. Dashboard shows: "Template update available (v1 → v2)"
7. Buyer clicks "Apply Update":
   a. Current workspace config backed up
   b. New snapshot unpacked over existing agents
   c. User customizations preserved where possible (API keys, channel tokens stay)
   d. Container redeployed with new config
8. If update breaks something: buyer can "Revert to v1" (from backup)
```

---

## 8. Cloud Deployment Engine

### Container Architecture (Validated March 2026)

```
Docker Container (ghcr.io/laxcorp/openclaw-runtime:latest)
┌────────────────────────────────────────────────────────────┐
│ Base: node:24-bookworm (Node >= 22.16.0)                    │
│ User: node (uid 1000)                                       │
│ Extensions: telegram, discord, slack, whatsapp, msteams     │
│                                                              │
│ CMD: node openclaw.mjs gateway --bind lan --port 18789      │
│                                                              │
│ Volume: /home/node/.openclaw (PERSISTENT — not tmpfs)        │
│   ├── openclaw.json, .env, cron/                            │
│   ├── workspace-orchestrator/ (SOUL.md, AGENTS.md, ...)     │
│   ├── workspace-worker-1/                                    │
│   └── workspace-critic/                                      │
│                                                              │
│ Ports: 18789 (Gateway WS + HTTP health)                      │
│ Health: /healthz (liveness) + /readyz (readiness)            │
│ Auth: OPENCLAW_GATEWAY_TOKEN env var                         │
│                                                              │
│ Limits: 1Gi memory, 1 CPU, 256 PIDs, no-new-privileges      │
│ Init: true (PID 1 signal handling via tini)                  │
│ Restart: on-failure, max 5 retries                           │
└────────────────────────────────────────────────────────────┘
```

### Custom Docker Image (build once, all customers use it)

```bash
# Built by CI/CD, pushed to our registry
docker build \
  --build-arg OPENCLAW_EXTENSIONS="telegram discord slack whatsapp msteams signal" \
  -t ghcr.io/laxcorp/openclaw-runtime:latest .

docker push ghcr.io/laxcorp/openclaw-runtime:latest
```

No published OpenClaw Docker image exists. We build our own from their Dockerfile with channel extensions baked in.

### Deployment Flow

```
1. GENERATING    — generator.ts converts DB state → workspace files
2. PROVISIONING  — Create Docker volume + container
3. CONFIGURING   — Copy workspace files into volume via tar stream
4. STARTING      — container.start()
5. HEALTH_CHECK  — Wait for /healthz (gateway process alive, 60s timeout)
6. WAITING_CHANNELS — Wait for /readyz (channels connected, 120s timeout)
7. COMPLETED     — Update workspace status to RUNNING
```

### Key Deployment Facts

- **Entrypoint:** `node openclaw.mjs gateway --bind lan --port 18789` (NOT `openclaw gateway run`)
- **`--bind lan`** is MANDATORY for Docker bridge networking (default loopback is unreachable)
- **Volume at `/home/node/.openclaw`** — must be persistent (agent writes memory files, session state)
- **Dual health probes:** `/healthz` = liveness (process up), `/readyz` = readiness (channels connected)
- **Gateway token:** `OPENCLAW_GATEWAY_TOKEN` env var (NOT in openclaw.json). Generated per deployment, stored encrypted in our DB for monitoring WebSocket connections.
- **One container = all agents** — single Gateway process manages all agents in `agents.list[]`
- **Config hot-reload:** Edit openclaw.json in the volume → changes auto-applied without restart. Useful for model changes, heartbeat interval updates, skill toggling.
- **Dynamic port mapping:** `PortBindings: { "18789/tcp": [{ HostPort: "0" }] }` — Docker assigns a random host port. We read it from container inspect and store in `workspace.hostPort`.

### Environment Variables in Container

```env
# Gateway auth (generated per deployment)
OPENCLAW_GATEWAY_TOKEN=<secure-random-token>

# AI Provider keys (decrypted from our DB)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...          # If user provided
GEMINI_API_KEY=...             # If user provided

# Channel tokens (from setup wizard step 4)
TELEGRAM_BOT_TOKEN=...         # If configured
DISCORD_BOT_TOKEN=...          # If configured
SLACK_BOT_TOKEN=...            # If configured
SLACK_APP_TOKEN=...            # If configured

# Runtime
TZ=UTC
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=768
```

---

## 9. Real-Time Monitoring System

### Activity Stream (Server-Sent Events)

```typescript
// app/api/activity/[workspaceId]/stream/route.ts

export async function GET(req: Request, { params }) {
  const session = await getServerSession()
  const workspace = await verifyWorkspaceOwnership(params.workspaceId, session.user.id)
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      
      // Send heartbeat every 15 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'))
      }, 15000)
      
      // Poll for new activity logs for this workspace
      let lastId = ''
      const poll = setInterval(async () => {
        const newLogs = await prisma.activityLog.findMany({
          where: {
            workspaceId: workspace.id,
            ...(lastId ? { id: { gt: lastId } } : {}),
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        })
        for (const log of newLogs) {
          const event = `data: ${JSON.stringify(log)}\n\n`
          controller.enqueue(encoder.encode(event))
          lastId = log.id
        }
      }, 2000) // Poll every 2 seconds
      
      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        clearInterval(poll)
        controller.close()
      })
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
```

### Container Log Parser

```typescript
// lib/openclaw/monitor.ts
// Parses OpenClaw container stdout into structured ActivityLog entries

function parseOpenClawLog(line: string): ActivityLog | null {
  // OpenClaw logs format: [timestamp] [agent] [action] message
  // Also handles: HEARTBEAT_OK, sessions_spawn events, sessions_send events, tool invocations
  
  // Match agent turn events
  const turnMatch = line.match(/\[(\w+)\] (completed|started|failed): (.+)/)
  if (turnMatch) {
    return {
      agentSlug: turnMatch[1],
      actionType: turnMatch[2] === 'completed' ? 'TASK_COMPLETE' : 
                  turnMatch[2] === 'started' ? 'TASK_START' : 'TASK_FAILED',
      action: turnMatch[3],
    }
  }
  
  // Match heartbeat events
  if (line.includes('HEARTBEAT_OK')) {
    return { actionType: 'HEARTBEAT', action: 'Heartbeat check — no action needed' }
  }
  
  // Match sessions_spawn (Orchestrator→Worker delegation — primary pattern)
  const spawnMatch = line.match(/sessions_spawn.*agent:(\w+).*(?:task|message): (.+)/)
  if (spawnMatch) {
    return {
      agentSlug: spawnMatch[1],
      actionType: 'TASK_START',
      action: `Spawned task: ${spawnMatch[2].substring(0, 200)}`,
    }
  }
  
  // Match sessions_send (peer-to-peer between depth-0 agents — rare in Claws)
  const sendMatch = line.match(/sessions_send.*agent:(\w+).*message: (.+)/)
  if (sendMatch) {
    return {
      agentSlug: sendMatch[1],
      actionType: 'TASK_START',
      action: `Received task: ${sendMatch[2].substring(0, 200)}`,
    }
  }
  
  // Match tool invocations
  const toolMatch = line.match(/tool_use: (\w+)/)
  if (toolMatch) {
    return { actionType: 'SKILL_INVOKED', action: `Invoked tool: ${toolMatch[1]}` }
  }
  
  return null
}
```

---

## 9.5 Trading Claw — Risk Management Architecture

The Market Intelligence & Trading Claw requires additional security, risk controls, and legal safeguards beyond standard Claws. This section covers the architecture specific to Claws that handle financial transactions.

### Dual Execution Modes

```typescript
// Configured per-workspace for trading Claws

interface TradingConfig {
  mode: 'ALERT_ONLY' | 'AUTONOMOUS'  // Default: ALERT_ONLY
  
  // Risk limits (enforced at container level, NOT by the LLM)
  maxTradeSize: number        // Max USD per single trade (e.g., $50)
  maxDailyLoss: number        // Circuit breaker: stop all trading if daily P&L < -$X
  maxPortfolioExposure: number // Max total capital deployed at any time
  maxTradesPerDay: number     // Prevent runaway execution (e.g., 100)
  approvedMarketTypes: string[] // e.g., ['polymarket', 'crypto_spot'] — NOT margin/leverage
  
  // Autonomous mode requires explicit acknowledgment
  autonomousOptInAt: DateTime?        // Null = not opted in
  autonomousRiskAcknowledged: boolean // Must be true to enable
  
  // Kill switch
  tradingPaused: boolean  // Human can instantly halt all trading
}
```

### Risk Enforcement (Container-Level, NOT LLM-Level)

```
CRITICAL ARCHITECTURE DECISION:
Risk limits are enforced by a SEPARATE validation layer OUTSIDE the LLM.
The LLM agent proposes trades. A deterministic risk check approves or blocks them.
We do NOT rely on the LLM to enforce its own limits (it can hallucinate or be jailbroken).

Flow:
  1. Signal Analyst proposes trade: "Buy YES on Market X at $0.23, size $100"
  2. Risk Manager agent validates (also LLM, provides reasoning)
  3. DETERMINISTIC RISK GATE (Python/TypeScript, NOT LLM):
     - Is trade size ≤ maxTradeSize? 
     - Would this exceed maxPortfolioExposure?
     - Is daily P&L still above maxDailyLoss?
     - Is market type in approvedMarketTypes?
     - Has maxTradesPerDay been reached?
     - Is tradingPaused = false?
  4. If ALL checks pass:
     - ALERT_ONLY mode: send to human for approval via Teams/WhatsApp
     - AUTONOMOUS mode: execute immediately, log to ActivityLog + AuditLog
  5. If ANY check fails: block trade, log reason, alert human

The deterministic gate is a simple function, not an AI call.
It cannot be prompt-injected or convinced to override limits.
```

### Audit Trail for Trades

```
Every trade action generates entries in BOTH ActivityLog AND AuditLog:

ActivityLog entry:
  - agentName: "Execution Advisor"
  - actionType: TRADE_RECOMMENDED | TRADE_AUTO_EXECUTED
  - metadata: {
      market: "Japan rate decision",
      direction: "YES",
      entryPrice: 0.23,
      size: 100,
      thesis: "BOJ leak suggests rate hold, Polymarket at 23¢ vs 68% probability",
      riskCheckResult: "PASSED",
      mode: "AUTONOMOUS"
    }

AuditLog entry:
  - action: TRADE_AUTO_EXECUTED
  - before: { portfolioExposure: 500, dailyPnL: 120 }
  - after: { portfolioExposure: 600, dailyPnL: 120 }
```

### Circuit Breakers

```
Three levels of automatic protection:

Level 1 — Soft alert (80% of daily loss limit):
  → Notify human: "Daily P&L at -$80 of $100 limit. 
     Continue trading? [Yes / Pause for today]"

Level 2 — Hard stop (100% of daily loss limit):
  → Immediately pause ALL trading activity
  → Close no existing positions (avoid panic selling)
  → Notify human: "Daily loss limit reached. Trading paused. 
     Review positions and manually resume when ready."

Level 3 — Emergency stop (tradingPaused = true OR container restart):
  → All pending orders cancelled
  → No new trades
  → Human must explicitly re-enable
```

### Legal & Compliance Requirements

```
Before a user can activate the Trading Claw:

1. Risk Disclosure Agreement (displayed during setup):
   - "This is a research and signal intelligence tool, not a financial advisor"
   - "Past performance does not guarantee future results"
   - "You may lose some or all of your capital"
   - "Claws is not a registered investment advisor"
   - "You are solely responsible for all trading decisions"
   - User must check acknowledgment box AND type "I understand the risks"

2. Autonomous Mode Additional Disclosure:
   - "Autonomous mode will execute trades without your approval"
   - "You set the limits. The system enforces them. But losses are still possible."
   - "You can pause autonomous trading at any time"
   - Requires separate explicit opt-in (not bundled with initial purchase)

3. Jurisdictional Restrictions:
   - Check user's country during setup
   - Block autonomous trading for users in jurisdictions where automated 
     trading tools require registration (varies by country)
   - Default to ALERT_ONLY mode for all users; autonomous is opt-in only

4. Record Keeping:
   - All trade recommendations, executions, and P&L stored for minimum 5 years
   - Exportable for user's tax reporting
   - AuditLog entries for every trade action (immutable)
```

---

## 10. Payment & Billing System

### Dodo Payments Integration & Pricing Model

**Why Dodo Payments:** Dodo is a Merchant of Record (MoR) — they handle tax compliance, refunds, disputes, and payment processing globally across 150+ countries, 80+ currencies. We don't need to worry about VAT/GST or international tax obligations. They have a dedicated Next.js adaptor (`@dodopayments/nextjs`) with 3 route handlers: Checkout, Customer Portal, and Webhooks.

```
PRICING MODEL:

┌─────────────────────────────────────────────────────────────┐
│ 1. TEMPLATE PURCHASE (one-time, yours forever on platform)  │
├─────────────────────────────────────────────────────────────┤
│ Official templates (by Claws team):                         │
│   Creator + Lifestyle templates:     $149                   │
│   Business Ops + Vertical templates: $199                   │
│   Quant Trader:                      $299                   │
│                                                             │
│ Community templates (by creators):                          │
│   Free or paid (minimum $19 for paid)                       │
│   0% commission — creators keep everything minus processing │
│   7-day hold before payout release (covers refund window)   │
│                                                             │
│ Includes: all agent configs, skills, workspace template     │
│ User owns the template forever (can redeploy anytime)       │
│ No export / no self-host — cloud-only                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. PLATFORM FEE (monthly, per running Claw)                 │
├─────────────────────────────────────────────────────────────┤
│ $79/month per Claw — everything included:                   │
│   Cloud deployment (2Gi RAM, managed container)             │
│   All channels (Telegram, Discord, Slack, WhatsApp, Web)    │
│   500+ tool integrations (Composio)                         │
│   Visual builder (customize agents, tools, settings)        │
│   Real-time monitoring dashboard                            │
│   Automatic template updates                                │
│   Health checks + auto-restart                              │
│   Priority email support                                    │
│                                                             │
│ 3-day free trial on first deploy (any template, free/paid)  │
│ No free tier. No subscription tiers. No export.             │
│ If workspace is PAUSED, platform fee is NOT charged         │
│ Cost to us: ~$16-25/mo per container (DigitalOcean)         │
│ Our margin: 70-84% depending on scale                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. SKILL MARKETPLACE                                        │
├─────────────────────────────────────────────────────────────┤
│ Official skills: free (bundled with OpenClaw)                │
│ Community skills: free or paid (minimum $5 for paid)        │
│ 0% commission — same model as templates                     │
│ 3-layer vetting: auto-scan → sandbox → manual review        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 4. AI MODEL COSTS (user pays directly to provider)          │
├─────────────────────────────────────────────────────────────┤
│ User brings their own API keys (Anthropic, OpenAI, Google)  │
│ We do NOT proxy or mark up AI model costs                   │
│ Typical monthly cost per Claw: $30-$90                      │
│ Enforced by deterministic cost gate at container level       │
│ Budget limit: $500/mo per workspace (configurable)          │
└─────────────────────────────────────────────────────────────┘

EXAMPLE CUSTOMER COST (2 Claws):
  Template 1 (B2B Sales, official): $199 one-time
  Template 2 (Community template): $49 one-time (creator keeps ~$47)
  Platform: $79/mo × 2 = $158/mo
  AI models: ~$80/mo (user pays Anthropic directly)
  ─────────────────────────────────
  Day 1:  $199 + $49 = $248 (templates)
  Day 1-3: $0 (trial, first deploy)
  Day 4+: $158/mo + $80/mo API = $238/month
```

### Dodo Payments Implementation

**Package:** `@dodopayments/nextjs` (install via npm)

**Products to create in Dodo dashboard (app.dodopayments.com):**
```
OUR REVENUE (we are the seller):
  1. "Claws Standard Template" — $149 one-time (Creator + Lifestyle)
  2. "Claws Business Template" — $199 one-time (Business Ops + Vertical)
  3. "Claws Premium Template" — $299 one-time (Quant Trader)
  4. "Claw Platform" — $79/mo recurring subscription
     - One subscription per active workspace
     - Created after 3-day trial ends (trial starts on first deploy)
     - Cancelled when user stops/deletes a Claw

CREATOR REVENUE (marketplace — we facilitate, creator is seller):
  5. Community template/skill purchases — dynamic pricing (creator sets price)
     - Processed through Dodo checkout with creator as beneficiary
     - 7-day hold before payout release
     - Weekly batch payouts to creators via Dodo Distribution API
     - We receive $0 from these sales (0% commission)
```

### Trial Logic

```typescript
// Triggered on first deploy (any template — free or paid)
async function handleFirstDeploy(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  
  if (!user.trialUsed) {
    const now = new Date()
    const trialEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) // 3 days
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        trialUsed: true,
        trialStartedAt: now,
        trialEndsAt: trialEnd,
      }
    })
    // Container deploys immediately, no payment needed
    // After 3 days: Dodo subscription auto-created via webhook or cron check
  } else {
    // Not first deploy — require active subscription for this workspace
    if (!user.hasActiveSubscription) {
      // Create Dodo checkout for $79/mo subscription
      throw new ApiError('SUBSCRIPTION_REQUIRED', 402)
    }
  }
}
```

### Marketplace Sale Flow

```typescript
// When a community template/skill is purchased:
// 1. Buyer clicks "Purchase" → Dodo checkout with creator as beneficiary
// 2. Dodo processes payment
// 3. Webhook fires onPaymentSucceeded
// 4. We create:
//    - TemplateInstall record (marks buyer as installer)
//    - MarketplaceSale record (amount, processing fee, payout status PENDING)
//    - Workspace from template snapshot (if template, not skill)
// 5. payoutHeldUntil = createdAt + 7 days
// 6. Weekly cron job: find sales where payoutStatus = PENDING AND payoutHeldUntil < now()
//    → Update to RELEASABLE
// 7. Weekly cron job: batch all RELEASABLE sales by creator
//    → Trigger Dodo batch payout to creator's beneficiary account
//    → Update to PROCESSING, then PAID when confirmed
```

**Route handlers:**
```typescript
// src/app/api/checkout/route.ts
import { Checkout } from "@dodopayments/nextjs"

export const POST = Checkout({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
  returnUrl: process.env.DODO_PAYMENTS_RETURN_URL,
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
  type: "session",
})

// src/app/api/customer-portal/route.ts
import { CustomerPortal } from "@dodopayments/nextjs"

export const GET = CustomerPortal({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY!,
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT,
})

// src/app/api/dodo/webhook/route.ts
import { Webhooks } from "@dodopayments/nextjs"

export const POST = Webhooks({
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,
  onPaymentSucceeded: async (payload) => {
    // Template purchased → create Workspace from template snapshot → start 3-day trial → redirect to setup
  },
  onPaymentFailed: async (payload) => {
    // Purchase failed → show error
  },
  onSubscriptionActive: async (payload) => {
    // Platform subscription activated (after trial) → workspace stays running
  },
  onSubscriptionCancelled: async (payload) => {
    // Cancelled → stop container, set workspace to STOPPED
  },
  onSubscriptionFailed: async (payload) => {
    // Renewal failed → mark past_due, alert user, grace period before stopping
  },
  onSubscriptionExpired: async (payload) => {
    // Expired → stop container, set workspace to STOPPED
  },
  onRefundSucceeded: async (payload) => {
    // Refund → stop container, delete workspace if within 7-day window
  },
  onSubscriptionRenewed: async (payload) => {
    // Renewal success → extend period, workspace stays running
  },
})
```

**Checkout flow:**
```
1. User clicks "Purchase this Claw"
2. POST /api/checkout → { product_cart: [{product_id, quantity}], customer: {email, name}, return_url, metadata }
3. Dodo returns { checkout_url } → redirect to Dodo-hosted checkout
4. User pays → Dodo webhook fires onPaymentSucceeded
5. Handler creates Workspace → user lands on setup wizard
```

**Customer billing portal:**
```
Settings > Billing → /api/customer-portal?customer_id={dodoCustomerId}
Dodo-hosted portal: manage subscriptions, payment methods, invoices, cancellations
We build zero billing UI — Dodo handles it all
```

**Environment variables:**
```
DODO_PAYMENTS_API_KEY=...           # From Dodo dashboard
DODO_PAYMENTS_WEBHOOK_KEY=...       # From Dodo dashboard → Webhooks
DODO_PAYMENTS_RETURN_URL=https://app.buildclaws.ai/checkout/success
DODO_PAYMENTS_ENVIRONMENT=live_mode # or test_mode for staging
```

---

## 11. The Visual Builder (React Flow Architecture)

### Canvas State Management

```typescript
// stores/builderStore.ts

interface BuilderState {
  // React Flow state
  nodes: Node<AgentNodeData>[]
  edges: Edge<ConnectionEdgeData>[]
  
  // Selection
  selectedAgentId: string | null
  selectedConnectionId: string | null
  
  // Panel state
  leftPanelTab: 'agents' | 'skills'
  rightPanelTab: 'properties' | 'preview'
  
  // Actions
  addAgent: (template?: Partial<Agent>) => void
  removeAgent: (id: string) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  addConnection: (source: string, target: string, condition: ConnectionCondition) => void
  removeConnection: (id: string) => void
  
  // Persistence (debounced auto-save to API)
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  saveWorkspace: () => Promise<void>
}
```

### Custom Agent Node

```typescript
// components/builder/AgentNode.tsx
// Rendered inside React Flow for each agent

interface AgentNodeData {
  agentId: string
  name: string
  role: string
  color: string
  model: string
  skillCount: number
  hasHeartbeat: boolean
  healthStatus: 'healthy' | 'idle' | 'error'
}

// Features:
// - Color-coded left border by agent role
// - Green dot for health status
// - Skill count badge
// - Heartbeat icon if scheduled
// - Click to select (opens properties panel)
// - Drag to reposition
// - Connection handles (top/bottom or left/right for source/target)
```

### Auto-Save Pattern

```typescript
// The builder auto-saves on every change with debouncing

const SAVE_DEBOUNCE_MS = 2000

// In builderStore:
updateAgent: (id, updates) => {
  set(state => ({
    nodes: state.nodes.map(n => 
      n.id === id ? { ...n, data: { ...n.data, ...updates } } : n
    ),
    isDirty: true,
  }))
  debouncedSave()  // Triggers API call after 2 seconds of no changes
}
```

### Version History & Undo (N1)

Every auto-save creates a snapshot. Users can revert to any previous version.

```typescript
model WorkspaceSnapshot {
  id          String @id @default(cuid())
  workspaceId String
  version     Int    // Auto-incrementing per workspace
  snapshot    Json   // Full workspace state: agents, connections, skills
  createdAt   DateTime @default(now())
  trigger     SnapshotTrigger // What caused this save
  label       String? // Optional user-provided label ("Before changing Critic model")
  
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  @@index([workspaceId, version])
  @@index([workspaceId, createdAt])
}

enum SnapshotTrigger {
  AUTO_SAVE     // Regular debounced auto-save
  MANUAL_SAVE   // User clicked "Save" explicitly
  PRE_DEPLOY    // Automatically taken before deployment
  TEMPLATE_LOAD // When workspace was first created from template
  USER_LABELED  // User explicitly labeled this version
}

// Retention policy:
// - Keep all snapshots from last 7 days
// - After 7 days: keep 1 per day for 30 days
// - After 30 days: keep 1 per week for 90 days
// - After 90 days: keep only MANUAL_SAVE, PRE_DEPLOY, and USER_LABELED snapshots
// - TEMPLATE_LOAD snapshot is NEVER deleted (always revertable to original template)

// Builder UI:
// - "History" button in top bar opens a side panel
// - Shows list of snapshots with timestamps, trigger type, and labels
// - Click any snapshot to preview diff against current state
// - "Revert to this version" restores the workspace to that snapshot
// - "Revert to template default" always available (restores TEMPLATE_LOAD snapshot)
```

---

## 12. Error Handling & Resilience

### Error Categories

```typescript
// lib/errors.ts

class ApiError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message?: string,
    public details?: Record<string, any>
  ) {
    super(message || code)
  }
}

// Standard error codes:
// AUTH_REQUIRED (401)
// FORBIDDEN (403)
// NOT_FOUND (404)
// VALIDATION_ERROR (400)
// WORKSPACE_LIMIT_REACHED (403)
// AGENT_LIMIT_REACHED (403)
// DEPLOYMENT_FAILED (500)
// CONTAINER_UNHEALTHY (503)
// API_KEY_INVALID (400)
// SPEND_LIMIT_REACHED (402)
// RATE_LIMITED (429)
// PAYMENT_ERROR (402)
// INTERNAL_ERROR (500)
```

### Container Recovery

```
Container crash → Docker auto-restart (max 5 in 10 min)
  → If 5 restarts exhausted:
    → Mark workspace DEGRADED
    → Email user with error logs
    → Create support ticket
    → Try rebuild with fresh container after 1 hour

Container timeout (no heartbeat response in 10 min):
  → Force restart
  → If still unresponsive: mark UNHEALTHY
  → Alert user

API key expiration/revocation:
  → Container logs auth failure
  → Mark workspace ERROR with message "API key invalid"
  → Email user: "Your Claude API key needs to be updated"
  → Container paused (not killed — preserves memory/state)
```

---

## 13. Testing Strategy

```
Unit Tests (Vitest):
  - Workspace config generator (most critical — must be 100% correct)
  - Encryption/decryption functions
  - Activity log parser
  - Permission checks
  - Zod validation schemas
  - Dodo Payments webhook handler logic
  
Integration Tests (Vitest + Prisma test client):
  - Full workspace CRUD lifecycle
  - Purchase → workspace creation → deployment flow
  - Agent connection validation (no circular dependencies, etc.)
  - API key encryption roundtrip
  
E2E Tests (Playwright):
  - Store: browse → purchase → workspace created
  - Builder: add agent → edit SOUL.md → connect agents → save
  - Deploy: configure → deploy → health check passes
  - Dashboard: activity feed updates in real-time
  
Container Tests (Docker Compose test environment):
  - Generated OpenClaw configs actually start successfully
  - Multi-agent communication works (sessions_spawn)
  - Heartbeat fires and logs activity
  - Channel connection (mock WhatsApp/Telegram)
  
Security Tests:
  - Workspace ownership isolation (user A can't access user B's workspace)
  - API key encryption never leaks plaintext in logs or responses
  - Container isolation (container can't access host filesystem)
  - Rate limiting works under load
  - XSS prevention in SOUL.md rendering
```

---

## 14. Observability & Logging

```
Application Logs (Vercel + custom):
  - Structured JSON logs with requestId, userId, action
  - Log levels: ERROR, WARN, INFO, DEBUG
  - Error logs include full stack trace + request context
  - Shipped to: Axiom (free tier: 500GB/mo ingest) or Vercel built-in

Container Logs:
  - Docker stdout/stderr captured and parsed
  - Stored: last 7 days in database (ActivityLog table)
  - Archived: S3 for 90 days (compressed)

Metrics:
  - Active containers count
  - API latency (p50, p95, p99)
  - Deployment success/failure rate
  - Average container uptime
  - API cost per customer per month
  - Store conversion rate
  
Alerting:
  - Container crash > 3 times in 10 min → PagerDuty/email
  - API error rate > 5% over 5 min → Slack alert
  - Customer spend > 80% of limit → customer email
  - Deployment failure → Slack alert
  - Database connection pool exhaustion → PagerDuty
```

---

## 15. Performance & Scaling

```
Frontend:
  - Server Components for Store pages (fast TTI, SEO)
  - Client Components for Builder/Dashboard (interactivity)
  - Image optimization via next/image
  - React Flow canvas: virtualized rendering (handles 50+ agents)
  - Bundle analysis: target < 200KB initial JS

API:
  - Connection pooling via Prisma (pool_size=10, timeout=5s)
  - Redis cache for: Claw templates (TTL 5m), skill list (TTL 1h)
  - Pagination on all list endpoints (cursor-based)
  - Activity stream: one SSE per workspace, not per agent

Database:
  - Indexed on all foreign keys and frequently queried fields
  - Partial indexes on status fields (only index non-DRAFT workspaces)
  - ActivityLog: time-partitioned, auto-archive after 30 days
  - Connection pool: min 2, max 10 (Neon connection limits)

Containers:
  - Pre-built OpenClaw Docker image (pulled once, cached)
  - Container startup time target: < 30 seconds
  - Max concurrent containers per host: 6-7 (based on 1Gi each on 8GB droplet)
  - Scale: add hosts when > 80% capacity
  - Target: support 500 concurrent containers at launch
```

---

## 16. CI/CD Pipeline

```
GitHub Actions:

PR Checks:
  - TypeScript type check
  - ESLint
  - Vitest unit + integration tests
  - Playwright E2E (against preview deployment)
  - Prisma schema validation
  - Bundle size check (fail if > 250KB)
  - Security: npm audit, Snyk scan

Main Branch:
  - All PR checks +
  - Deploy to Vercel Production
  - Run Prisma migrations
  - Smoke tests against production
  - Container image rebuild (if Dockerfile changed)

Release (tagged):
  - Full test suite
  - Production deployment
  - Database migration
  - Container image push to registry
  - Changelog generation
```

---

## 17. Environment Configuration

```
# .env.local (development)
# .env.production (production — stored in Vercel)

# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# Auth
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="https://app.buildclaws.ai"
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Encryption
ENCRYPTION_MASTER_KEY="..."  # 32-byte hex string for AES-256-GCM
ENCRYPTION_KEY_VERSION="v1"

# Dodo Payments
DODO_PAYMENTS_API_KEY="..."              # From Dodo dashboard
DODO_PAYMENTS_WEBHOOK_KEY="..."         # From Dodo → Webhooks
DODO_PAYMENTS_RETURN_URL="https://app.buildclaws.ai/checkout/success"

# Redis
UPSTASH_REDIS_REST_URL="..."
UPSTASH_REDIS_REST_TOKEN="..."

# Container Infrastructure
DOCKER_HOST="tcp://container-host:2376"
DOCKER_TLS_VERIFY=1
DOCKER_CERT_PATH="/certs"
CONTAINER_NETWORK="laxclaws-isolated"
CONTAINER_REGISTRY="ghcr.io/laxcorp"

# S3 (workspace exports + backups)
S3_BUCKET="laxclaws-data"
S3_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."

# Observability
AXIOM_TOKEN="..."
AXIOM_DATASET="laxclaws-logs"

# Feature Flags
ENABLE_CLOUD_DEPLOY=true
MAX_WORKSPACES_PER_USER=20
```

---

## 18. Migration & Rollback Strategy

```
Database Migrations:
  - Prisma Migrate for schema changes
  - All migrations are additive (never drop columns in production)
  - Destructive changes use a 3-step process:
    1. Add new column/table
    2. Migrate data in background
    3. Remove old column in next release (after verification)
  - Rollback: Prisma migrate reset is NEVER used in production
  - Rollback: Restore from point-in-time backup (Neon point-in-time recovery)

Application Rollback:
  - Vercel instant rollback to previous deployment
  - Feature flags for risky features (disable without deploy)

Container Rollback:
  - Each deployment stores a config snapshot
  - Rollback = redeploy with previous snapshot
  - Container image pinned to specific tag (not :latest in production)
```

---

## 19. Multi-Agent Hierarchy Architecture (Validated March 2026)

### How Multi-Agent Actually Works in OpenClaw

OpenClaw uses a **spawn-depth hierarchy**, not explicit `reportsTo` relationships:

| Depth | Role | Capabilities | Our Mapping |
|-------|------|-------------|-------------|
| 0 | `main` | Full access: `sessions_send` + `sessions_spawn` + channels | ORCHESTRATOR |
| 1 | `orchestrator` | Can `sessions_spawn` children, NO `sessions_send` | (internal spawn level) |
| 2 | `leaf` | Execute only, no spawn, no session management | WORKER / CRITIC |

### Communication Mechanisms

| Mechanism | Who Can Use | Purpose | Claws Usage |
|-----------|------------|---------|----------------|
| `sessions_spawn` | Depth 0-1 | Parent spawns child task; result returns via announce chain | Orchestrator → Worker, Orchestrator → Critic |
| `sessions_send` | Depth 0 only | Peer-to-peer between top-level agents | NOT used in v1 (future: cross-Claw communication) |

Workers (spawned as subagents) are **DENIED** `sessions_send`. Results flow back to the Orchestrator automatically when the subagent task completes.

### Our Orchestrator → Worker → Critic Pattern

```
Orchestrator (depth 0, default=true, bound to all channels)
  │
  ├── sessions_spawn(agentId: "market-scanner", task: "Scan BTC/USD...")
  │   └── Market Scanner executes → result announces back to Orchestrator
  │
  ├── sessions_spawn(agentId: "signal-analyst", task: "Analyze signals...")
  │   └── Signal Analyst executes → result announces back
  │
  └── sessions_spawn(agentId: "trade-thesis-reviewer", task: "Review this analysis...")
      └── Critic reviews → APPROVED/REJECTED announces back
          └── If REJECTED: Orchestrator re-spawns Worker with feedback
          └── If APPROVED: Orchestrator presents to human
```

### Config Requirements

```json5
// In openclaw.json agents.list[]:
{
  "id": "orchestrator",
  "default": true,              // Receives channel messages
  "subagents": {
    "allowAgents": ["worker-1", "worker-2", "critic"],  // Which agents it can spawn
    "model": "anthropic/claude-sonnet-4-6"               // Default model for subagents
  }
}

// In agents.defaults:
{
  "subagents": {
    "maxSpawnDepth": 2,
    "maxChildrenPerAgent": 8    // Must be >= number of Workers + 1 (for Critic)
  }
}
```

### What Workers and Critic See at Runtime

Non-main sessions (subagents) only receive these workspace files in their system prompt:
- AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md

They do NOT see: HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md. This is correct — Workers are task-focused.

### Visual Builder ↔ OpenClaw Mapping

| Builder Concept | OpenClaw Reality |
|----------------|-----------------|
| Agent node with role | Entry in `agents.list[]` with own workspace dir |
| Connection line (A → B) | Instructions in A's AGENTS.md to `sessions_spawn` B |
| ON_COMPLETE condition | Natural language in AGENTS.md: "After Worker completes, spawn Critic" |
| ON_APPROVAL condition | Natural language: "If Critic approves (8+/10), present to human" |
| ON_REJECTION condition | Natural language: "If Critic rejects, re-spawn Worker with feedback" |
| `reportsTo` field | UI-only concept. NOT in any OpenClaw config. Kept in Prisma for Builder visualization. |
| Quality threshold slider | Written into Critic's SOUL.md as the passing score |

---

## 20. Tool Connection & Skills Architecture (Validated March 2026)

### How Tools Work in OpenClaw

There is **no CONNECTED_TOOLS.md** — this file does not exist in OpenClaw. Tool integration works through three mechanisms:

| Mechanism | What It Does | Where It Lives |
|-----------|-------------|----------------|
| **TOOLS.md** | Freeform environment notes ("Your CRM is HubSpot") | Per-agent workspace file |
| **Skill SKILL.md** | Tool-specific instructions (HubSpot API commands) | `workspace/skills/{slug}/SKILL.md` |
| **skills.entries** | Tool credentials (API keys as env vars) | `openclaw.json` |

### Tool Connection Flow

```
User connects HubSpot in Setup Wizard Step 2
  │
  ├── 1. Generator creates: skills/hubspot-crm/SKILL.md
  │      (HubSpot-specific API instructions in markdown)
  │
  ├── 2. Generator adds to openclaw.json:
  │      skills.entries.hubspot-crm.env.HUBSPOT_API_KEY = "decrypted-key"
  │
  ├── 3. Generator writes to TOOLS.md:
  │      "Your CRM is HubSpot. Use the hubspot-crm skill."
  │
  └── 4. Generator adds to agents.list[].skills:
         Only agents assigned this skill see it in their catalog
```

### Skill System Architecture

**Skills are markdown instructions, not code.** The agent reads them and follows them using built-in tools (`bash`, `read`, `write`, `browser`).

**Execution flow:**
1. Skill catalog (`<available_skills>` XML with name + description + location) injected into system prompt
2. User makes a request → agent scans catalog descriptions → picks matching skill
3. Agent uses `read` tool to load the full SKILL.md content
4. Agent follows the instructions (runs bash commands, calls APIs, etc.)

**This means:** Skills are loaded on-demand, not pre-injected. Only the catalog is in every system prompt. Token-efficient.

### Skill File Format

```yaml
---
name: hubspot-crm
description: "Manage contacts, deals, and companies in HubSpot CRM. Use when: user asks about leads, contacts, deals, pipeline. NOT for: email sending, calendar."
metadata:
  openclaw:
    emoji: "🔗"
    requires:
      bins: ["curl"]
---

# HubSpot CRM

## Authentication
API key is available as $HUBSPOT_API_KEY environment variable.

## Common Operations
- List contacts: curl -H "Authorization: Bearer $HUBSPOT_API_KEY" https://api.hubapi.com/crm/v3/objects/contacts
- Create deal: curl -X POST -H "Authorization: Bearer $HUBSPOT_API_KEY" -d '{"properties":{"dealname":"...","pipeline":"default","dealstage":"appointmentscheduled"}}' https://api.hubapi.com/crm/v3/objects/deals
...
```

### Skill Credentials in openclaw.json

```json5
{
  "skills": {
    "entries": {
      "hubspot-crm": {
        "enabled": true,
        "env": { "HUBSPOT_API_KEY": "abc123" }  // Decrypted at deploy time
      },
      "binance-api": {
        "enabled": true,
        "env": { "BINANCE_API_KEY": "xyz789", "BINANCE_SECRET": "..." }
      }
    }
  }
}
```

Eligibility check: if a skill declares `requires.env: ["HUBSPOT_API_KEY"]` and that env var is missing from `skills.entries`, the skill is excluded from the catalog. The agent never sees it.

### Per-Agent Skill Filtering

```json5
{
  "agents": {
    "list": [
      { "id": "orchestrator", "skills": [] },                    // No tools — just delegates
      { "id": "lead-enricher", "skills": ["hubspot-crm", "apollo-search"] },
      { "id": "sequence-writer", "skills": ["gmail-send"] },
      { "id": "critic", "skills": [] }                           // Reviews, doesn't use tools
    ]
  }
}
```

Maps directly to our Builder's skill picker checkboxes per agent.

### ~55 Bundled Skills

OpenClaw ships with ~55 built-in skills (weather, github, filesystem, etc.). We do NOT generate these. We only generate skills for domain-specific tools the user connected:

| We Generate | Bundled (Free) |
|-------------|---------------|
| hubspot-crm, apollo-search, binance-api, shopify-store, gmail-send, instantly-email, etc. | weather, github, filesystem, web-search, browser, calendar, etc. |

### Tool Swap Behavior

When a user swaps tools in the Setup Wizard (e.g., HubSpot → Pipedrive):
1. Delete `skills/hubspot-crm/` directory
2. Create `skills/pipedrive-crm/SKILL.md` with Pipedrive-specific instructions
3. Update `openclaw.json` skills.entries (remove hubspot, add pipedrive)
4. Update TOOLS.md ("Your CRM is now Pipedrive")
5. Agent skill filtering stays the same (it references the category, not the specific tool)

---

## 21. HEARTBEAT & Cron Architecture (Validated March 2026)

### Two Separate Systems

| System | What | Where | Purpose |
|--------|------|-------|---------|
| **HEARTBEAT.md** | Task checklist | Per-agent workspace file | WHAT to do periodically |
| **Heartbeat interval** | Timing config | `openclaw.json` `agents.defaults.heartbeat.every` | HOW OFTEN the gateway prompts the agent |
| **Cron jobs** | Advanced scheduling | `cron/jobs.json` | WHEN to run specific tasks (cron expressions, one-shots, intervals) |

### HEARTBEAT.md (Task Checklist)

```markdown
# Periodic Tasks

- [ ] Check for new leads in Apollo pipeline
- [ ] Review any pending outreach sequences
- [ ] Scan for hot replies that need immediate response
- [ ] Update pipeline report with today's metrics
- [ ] Check if any tool connections have expired
```

The gateway's heartbeat runner sends the default heartbeat prompt: "Read HEARTBEAT.md if it exists. Follow it strictly." Empty HEARTBEAT.md = skip heartbeat API calls.

Only the Orchestrator gets HEARTBEAT.md. Workers don't (they're spawned on-demand).

### Heartbeat Interval (in openclaw.json)

```json5
{
  "agents": {
    "defaults": {
      "heartbeat": { "every": "30m" }  // Prompt agent every 30 minutes
    }
  }
}
```

### Cron Jobs (cron/jobs.json)

For tasks that need specific timing beyond the heartbeat interval:

```json
[
  {
    "name": "morning-briefing",
    "schedule": { "kind": "cron", "expr": "0 8 * * 1-5", "tz": "America/New_York" },
    "sessionTarget": "main",
    "wakeMode": "now",
    "payload": {
      "kind": "agentTurn",
      "message": "Generate the daily morning briefing.",
      "lightContext": false
    },
    "delivery": {
      "mode": "announce",
      "channel": "telegram",
      "bestEffort": true
    }
  }
]
```

Schedule types: `cron` (5/6-field expression with timezone), `every` (interval in ms), `at` (one-shot ISO 8601).

---

## 22. Additional Configuration Reference

OpenClaw's HEARTBEAT.md follows a specific format. This is the actual file content that the gateway daemon parses.

```markdown
# HEARTBEAT.md — Agent: Trade Commander (Orchestrator)

## Schedule

### market_scan
- cron: "*/30 * * * *"  # Every 30 minutes
- enabled: true
- message: "Run market scan cycle. Check all connected markets for opportunities."

### daily_report
- cron: "0 8 * * *"  # Every day at 8:00 AM (in container timezone — set during deployment)
- enabled: true
- message: "Generate daily portfolio report and send to human via connected channel."

### weekly_strategy_review
- cron: "0 20 * * 0"  # Sunday 8:00 PM
- enabled: true
- message: "Conduct weekly strategy review. Analyze trades, update performance metrics, adjust strategies."

## Notes
- Cron expressions use standard 5-field format: minute hour day-of-month month day-of-week
- The gateway fires the heartbeat by sending the `message` to the agent's main session
- `enabled: false` pauses that specific heartbeat without removing it
- Multiple heartbeats can fire at the same time — they're queued sequentially
```

### HEARTBEAT.md per Claw Category (template examples)

**Money-Making Claws (frequent monitoring):**
```
market_scan:    "*/30 * * * *"    # Every 30 min (trading needs real-time)
daily_report:   "0 8 * * *"      # 8 AM daily
weekly_review:  "0 20 * * 0"     # Sunday 8 PM
```

**Creator Claws (content cadence):**
```
content_planning:  "0 7 * * 1"      # Monday 7 AM (weekly planning)
engagement_check:  "0 9,18 * * *"   # 9 AM + 6 PM daily (comments/replies)
analytics_pull:    "0 20 * * *"     # 8 PM daily (end of day metrics)
monthly_review:    "0 8 1 * *"      # 1st of month 8 AM
```

**Business Ops Claws (work-day focus):**
```
morning_briefing:  "0 7 * * 1-5"   # Weekdays 7 AM
midday_check:      "0 13 * * 1-5"  # Weekdays 1 PM
weekly_report:     "0 17 * * 5"    # Friday 5 PM
monthly_review:    "0 9 1 * *"     # 1st of month 9 AM
```

**Vertical Claws (24/7 availability):**
```
continuous_intake:  "*/5 * * * *"   # Every 5 min (always monitoring for leads/calls)
morning_briefing:   "0 7 * * *"    # 7 AM daily
recall_campaign:    "0 10 * * 2,4" # Tue+Thu 10 AM
weekly_report:      "0 17 * * 5"   # Friday 5 PM
```

**Lifestyle Claws (personal cadence):**
```
morning_checkin:    "0 7 * * *"    # 7 AM daily
evening_review:     "0 21 * * *"   # 9 PM daily
weekly_review:      "0 8 * * 0"    # Sunday 8 AM
```

During deployment, the workspace generator creates a HEARTBEAT.md for each agent using the schedule from the Claw Engineering Spec. The user can modify the schedule in the Builder (bottom bar heartbeat config UI).

---

## 23. Accessibility Requirements

### Minimum Standards (WCAG 2.1 AA)

```
KEYBOARD NAVIGATION:
- All interactive elements must be reachable via Tab key
- Focus order must follow visual layout (top-to-bottom, left-to-right)
- Focus indicators must be visible (2px solid outline, high contrast)
- Modal dialogs must trap focus within the modal
- Escape key must close modals and dropdowns
- React Flow canvas: arrow keys to move between nodes, Enter to select, 
  Tab to move to properties panel

COLOR & CONTRAST:
- Text: minimum 4.5:1 contrast ratio against background (AA standard)
- Large text (>18px): minimum 3:1 contrast ratio
- Interactive elements (buttons, links): minimum 3:1 against adjacent colors
- Status indicators: NEVER use color alone — always include icon or text
  - ✅ Green dot + "Running" text (not just green dot)
  - ❌ Red dot + "Error" text (not just red dot)
  - ⚠️ Yellow dot + "Paused" text
- Dark mode: all contrast ratios must be maintained

SCREEN READERS:
- All images: meaningful alt text or aria-hidden if decorative
- Form inputs: associated <label> elements or aria-label
- Buttons: descriptive text (not just icons)
- Status changes: aria-live regions for real-time updates
  - Activity feed: aria-live="polite" (don't interrupt)
  - Error banners: aria-live="assertive" (announce immediately)
  - Deployment progress: aria-live="polite" with step descriptions
- Page titles: unique, descriptive <title> tags per route
- Headings: proper hierarchy (h1 → h2 → h3, no skipping)

REACT FLOW CANVAS (Builder):
- Agent nodes: role="button", aria-label="[Agent name], [role], [status]"
- Connections: role="img", aria-label="Connection from [source] to [target], condition: [condition]"
- Canvas: role="application" with keyboard instructions
- Properties panel: standard form controls, all keyboard accessible

MOTION:
- Respect prefers-reduced-motion media query
- Disable animations for users who request it
- Loading spinners: include aria-label="Loading"
```

### Implementation Notes

```typescript
// components/shared/StatusBadge.tsx — accessible status indicator
function StatusBadge({ status }: { status: 'running' | 'paused' | 'error' | 'draft' }) {
  const config = {
    running: { color: 'bg-green-500', text: 'Running', icon: '●' },
    paused:  { color: 'bg-yellow-500', text: 'Paused', icon: '⏸' },
    error:   { color: 'bg-red-500', text: 'Error', icon: '⚠' },
    draft:   { color: 'bg-gray-400', text: 'Draft', icon: '○' },
  }[status]
  
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span className={`w-2 h-2 rounded-full ${config.color}`} aria-hidden="true" />
      <span className="text-xs font-medium">{config.text}</span>
    </span>
  )
}
// NEVER use color-only indicators like <span className="w-2 h-2 rounded-full bg-green-500" />
// without accompanying text
```

---

## 24. Documentation Structure

The "Docs" link in the navigation points to an external Mintlify documentation site.

```
Documentation Site Structure:
docs.buildclaws.ai (Mintlify)

├── Getting Started
│   ├── What is Claws?
│   ├── Quick Start (first Claw in 10 minutes)
│   ├── How pricing works
│   └── FAQ
│
├── Platform Guide
│   ├── Store & Purchasing
│   ├── The Setup Wizard
│   ├── Visual Builder
│   │   ├── Adding agents
│   │   ├── Configuring SOUL.md
│   │   ├── Configuring AGENTS.md
│   │   ├── Setting up heartbeats
│   │   └── Version history & undo
│   ├── Tool Connections
│   │   ├── API key tools
│   │   ├── OAuth tools (Composio)
│   │   ├── Custom APIs
│   │   └── Tool swapping
│   ├── Deployment
│   │   ├── Cloud hosting
│   │   ├── Getting started guide
│   │   └── Troubleshooting
│   ├── Dashboard
│   │   ├── Activity feed
│   │   ├── Pending approvals
│   │   ├── Cost management
│   │   └── Agent health monitoring
│   └── Settings & Billing
│
├── Claw Guides (one page per Claw)
│   ├── Quant Trader — Setup, tool configuration, risk settings
│   ├── B2B Sales Machine — ICP setup, email domain configuration
│   ├── YouTube Channel OS — Channel connection, content workflow
│   ├── [... all 20 Claws]
│   └── Each guide includes:
│       ├── What this Claw does (overview)
│       ├── Required and recommended tools (with signup links)
│       ├── Setup walkthrough with screenshots
│       ├── How to customize agent behavior
│       ├── Edge cases and troubleshooting
│       └── FAQ specific to this Claw
│
├── OpenClaw Reference
│   ├── What is OpenClaw?
│   ├── SOUL.md reference
│   ├── AGENTS.md reference
│   ├── HEARTBEAT.md reference
│   ├── Memory system
│   └── Skills and tools
│
├── API Reference (future)
│   ├── Authentication
│   ├── Workspaces API
│   ├── Agents API
│   ├── Deployments API
│   └── Webhooks
│
└── Legal
    ├── Terms of Service
    ├── Privacy Policy
    ├── Acceptable Use Policy
    └── Risk Disclosure (for trading Claws)
```

Documentation is NOT built in Phase 1-4. Prioritize after launch MVP.
For launch: a single "Getting Started" page and per-Claw setup guides are sufficient.
The "Docs" nav link points to `https://docs.buildclaws.ai` (Mintlify hosted).

---

## 25. Marketplace Architecture

### Search & Pagination

All marketplace list endpoints (`/api/marketplace/templates`, `/api/marketplace/skills`) support:

```typescript
// Query parameters
interface MarketplaceListParams {
  // Filtering
  category?: ClawCategory        // Filter by category
  trustTier?: TrustTier           // Minimum trust tier (e.g., VERIFIED = show VERIFIED + OFFICIAL)
  isFree?: boolean                // true = free only, false = paid only, omit = all
  creatorId?: string              // Filter by specific creator
  
  // Search — PostgreSQL full-text search on name + description + tags
  search?: string                 // e.g., "trading crypto"
  
  // Sorting
  sort?: 'popular' | 'newest' | 'price_asc' | 'price_desc' | 'rating'
  // popular = installCount desc (default)
  // newest = publishedAt desc
  // price_asc/desc = price asc/desc (free items sorted first/last)
  // rating = avgRating desc (minimum 3 reviews to rank)
  
  // Pagination — cursor-based (NOT offset)
  cursor?: string                 // ID of last item from previous page
  limit?: number                  // Default 20, max 50
}

// Response includes
interface MarketplaceListResponse {
  items: TemplateCard[] | SkillCard[]
  nextCursor: string | null       // null = no more pages
  totalCount: number              // For display: "Showing 1-20 of 147"
}
```

Required database indexes (already in schema):
- `@@index([category])`, `@@index([trustTier])`, `@@index([isPublished])`, `@@index([installCount])`
- Full-text search: create a PostgreSQL `tsvector` index on `name || ' ' || description || ' ' || array_to_string(tags, ' ')`

### Similar Templates Algorithm

Template detail page shows 3 related templates:
```sql
-- Same category, same price tier, excluding current template
-- Price tiers: free (price IS NULL), standard ($1-99), premium ($100+)
-- Sorted by installCount desc
-- If < 3 results in same price tier, backfill from same category any tier
SELECT * FROM "ClawTemplate"
WHERE category = $currentCategory
  AND id != $currentId
  AND "isPublished" = true
  AND (
    CASE 
      WHEN $currentPrice IS NULL THEN price IS NULL
      WHEN $currentPrice < 100 THEN price > 0 AND price < 100
      ELSE price >= 100
    END
  )
ORDER BY "installCount" DESC
LIMIT 3
```

### Template Name Conflict Validation

On `POST /api/marketplace/templates` (community publish):
```typescript
// Reject if name matches any OFFICIAL template (case-insensitive)
const conflict = await prisma.clawTemplate.findFirst({
  where: {
    name: { equals: submittedName, mode: 'insensitive' },
    trustTier: 'OFFICIAL'
  }
})
if (conflict) throw new ApiError('NAME_CONFLICTS_WITH_OFFICIAL', 409,
  `Template name "${submittedName}" conflicts with official template "${conflict.name}"`)
```

### Template Skill Dependency Validation

On template publish, verify all referenced skills exist:
```typescript
// Extract skill slugs from workspaceSnapshot
const snapshot = JSON.parse(template.workspaceSnapshot)
const referencedSkills = extractSkillSlugs(snapshot) // From all agents' skill assignments

// Check each skill is either bundled (~55 OpenClaw skills) or in our marketplace
const bundledSlugs = BUNDLED_OPENCLAW_SKILLS // Static list of ~55 slugs
const marketplaceSkills = await prisma.marketplaceSkill.findMany({
  where: { slug: { in: referencedSkills }, isPublished: true }
})
const availableSlugs = [...bundledSlugs, ...marketplaceSkills.map(s => s.slug)]

const missing = referencedSkills.filter(s => !availableSlugs.includes(s))
if (missing.length > 0) {
  throw new ApiError('SKILLS_NOT_AVAILABLE', 400,
    `Template references skills not available on the platform: ${missing.join(', ')}`)
}
```

---

## 26. Skill Vetting Pipeline

### Three-Layer Security Pipeline

Every community skill goes through all 3 layers before reaching "VERIFIED" status. Layer 1 runs on submit (synchronous). Layers 2-3 run asynchronously.

### Layer 1: Automated Scan (on submit, synchronous)

Pattern matching against SKILL.md content. No container needed.

```typescript
interface ScanResult {
  passed: boolean
  findings: ScanFinding[]
}

interface ScanFinding {
  severity: 'critical' | 'warning' | 'info'
  pattern: string
  line: number
  description: string
}

const CRITICAL_PATTERNS = [
  // Exfiltration
  /curl.*\$\{?[A-Z_]*KEY/i,           // curl with API key variables
  /curl.*\$\{?[A-Z_]*TOKEN/i,         // curl with token variables
  /curl.*\$\{?[A-Z_]*SECRET/i,        // curl with secret variables
  /wget.*\$\{?[A-Z_]*KEY/i,           // wget with API key variables
  /base64\s+(encode|decode)/i,         // Base64 operations (obfuscation)
  /eval\s*\(/,                         // Code execution
  /\$\(.*\$\{/,                        // Nested command substitution with vars
  
  // File access outside workspace
  /\/etc\/shadow/,                     // System files
  /\/root\//,                          // Root directory
  /~\/.ssh/,                           // SSH keys
  /\.env(?!\s*var)/,                   // .env file access (but allow "env var" text)
  /\/home\/node\/\.openclaw\/(?!skills)/, // OpenClaw config outside skills dir
  
  // Network to unknown hosts  
  /curl\s+https?:\/\/(?!api\.|www\.)[a-z0-9-]+\.[a-z]{2,}/i, // Outbound to non-API domains
]

const WARNING_PATTERNS = [
  /chmod\s+[0-7]*7[0-7]*/,            // World-readable/writable permissions
  /rm\s+-rf/,                          // Recursive delete
  />\s*\/dev\/null\s*2>&1/,            // Suppressing errors (hiding activity)
  /nohup/,                             // Background processes
  /crontab/,                           // Scheduling (should use OpenClaw's cron)
]
```

If any CRITICAL pattern matches → skill is **rejected** immediately with findings shown to creator.
If only WARNING patterns → skill is listed as **UNREVIEWED** with warnings noted in `autoScanReport`.

### Layer 2: Sandbox Test (async, queued)

```
1. Spin up a disposable Docker container (same OpenClaw runtime image)
2. Install the skill: copy SKILL.md to agent skills directory
3. Create a minimal openclaw.json with one test agent that has this skill
4. Start the gateway
5. Send a test prompt that would trigger the skill
6. Monitor for 60 seconds:
   - Network calls: log all outbound connections (destination, port, payload size)
   - File access: log all file reads/writes outside the skill directory
   - Process spawning: log any child processes created
   - Memory usage: ensure no memory bomb
7. Tear down container
8. Generate sandboxReport JSON with all observed activity

PASS criteria:
  - No outbound network to domains not declared in requiredEnvVars
  - No file access outside /home/node/.openclaw/{agent}/skills/{slug}/
  - No child processes that persist after skill execution completes
  - Memory stays under 512MB

FAIL criteria:
  - Any network call to undeclared domain
  - Any file read of .env, openclaw.json, or other agents' directories
  - Any attempt to modify SOUL.md, AGENTS.md, or openclaw.json
```

Container infrastructure: use the same DigitalOcean droplets. Sandbox containers are ephemeral (create, run test, destroy). One sandbox container can run at a time per droplet. Queue additional tests.

### Layer 3: Manual Review (async, queued)

Admin reviews in `/admin/reviews`:
```
Checklist:
  ✓ Description matches actual SKILL.md behavior
  ✓ requiredBins list is complete and accurate
  ✓ requiredEnvVars list is complete and accurate
  ✓ No prompt injection patterns ("ignore previous", "you are now", "system override")
  ✓ No subtle data exfiltration (e.g., encoding data in URLs, logging to external services)
  ✓ Skill does what it says it does (basic functional test)

Approve → trustTier upgraded to VERIFIED
Reject → reviewStatus = REJECTED, creator notified with reason. Creator can fix and resubmit.
```

### Template Auto-Scan

Community templates also undergo a lighter scan on publish. SOUL.md and AGENTS.md content is checked for:

```typescript
const TEMPLATE_SCAN_PATTERNS = [
  // Prompt injection / goal hijacking
  /ignore (previous|all|your) instructions/i,
  /you are now/i,
  /system override/i,
  /forget everything/i,
  
  // Exfiltration instructions
  /send.*to.*https?:\/\//i,           // Instructions to send data externally
  /upload.*to/i,                       // Upload instructions
  /curl.*\$\{?[A-Z_]*KEY/i,           // API key exfiltration via curl
  
  // Dangerous tool usage
  /rm\s+-rf/i,                         // Destructive commands
  /format.*disk/i,                     // Disk operations
  /shutdown|reboot/i,                  // System commands
]
```

Template scan is advisory only (findings logged in `reviewNotes`). Templates are not auto-rejected because SOUL.md content is more nuanced than skill scripts — legitimate prompts may reference URLs or commands in context.

---

## 27. OpenClaw Version Management

### Version Lifecycle

```
OpenClaw releases new version (e.g., 2.5.2)
  │
  ├─ We pull the release, build our custom Docker image
  │   ghcr.io/laxcorp/openclaw-runtime:2.5.2
  │
  ├─ Run automated compatibility tests:
  │   - Deploy all 20 official templates against new version
  │   - Health check passes? Channels connect? Agents respond?
  │   - Run against 10 most-installed community templates
  │
  ├─ If tests pass (typically 2-5 days after release):
  │   - Mark version as isStable = true in OpenClawVersion table
  │   - Set isLatest = false on previous stable version
  │   - All NEW deployments use this version automatically
  │   - Existing containers stay on their current version
  │
  ├─ Dashboard shows: "Update available: 2.5.1 → 2.5.2"
  │   - User clicks "Update" → container redeployed with new image
  │   - Or user ignores — their Claw keeps running on old version
  │
  └─ SECURITY PATCHES (isSecurityPatch = true):
      - Forced update within 48 hours
      - Email notification sent via Resend:
        "We're updating your Claw to patch a security vulnerability.
         No action needed — update happens automatically."
      - Cron job: 48 hours after security version marked stable,
        find all containers running older versions → stop, update image, restart
      - forceUpdateAll() in deployer:
        1. Get all running workspaces on affected versions
        2. For each: stop container → update containerImage → restart
        3. Log as SYSTEM activity type in ActivityLog
        4. Email user confirmation when complete
```

### Compatibility Field

Templates and skills have `minOpenClawVersion` field:
```
Dashboard shows version status per workspace:
  ✓ "Compatible" — workspace version >= template's minOpenClawVersion
  ⚠ "Update recommended" — newer stable version available
  ✗ "Incompatible" — template requires newer version than workspace runs

When displaying templates in marketplace:
  - If user has running workspaces, show compatibility status
  - "Works with your version" or "Requires OpenClaw 2.5.0+"
```

---

## Appendix: First Cursor Prompt (Phase 1 Kickoff)

When starting the Claude Project, the first prompt to generate for Cursor should scaffold:

1. `npx create-next-app@latest laxclaws --typescript --tailwind --eslint --app --src-dir`
2. Install dependencies: `prisma`, `@prisma/client`, `next-auth`, `zustand`, `reactflow`, `zod`, `dodo`, `@upstash/ratelimit`, `@upstash/redis`
3. Install shadcn/ui: `npx shadcn-ui@latest init` + core components
4. Create Prisma schema from Section 3
5. Create the base layout with TopBar and Navigation
6. Create the Store page with static Claw card data
7. Configure environment variables template

This single prompt gets the project from zero to a browsable Store page in one Cursor session.
