-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ApiProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'OPENROUTER', 'OLLAMA');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('DRAFT', 'SETUP_INCOMPLETE', 'DEPLOYING', 'RUNNING', 'PAUSED', 'ERROR', 'STOPPED');

-- CreateEnum
CREATE TYPE "DeploymentType" AS ENUM ('CLOUD', 'SELF_HOSTED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConnectionCondition" AS ENUM ('ON_COMPLETE', 'ON_APPROVAL', 'ON_REJECTION', 'ON_SCHEDULE', 'ON_HUMAN_APPROVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('BUILT_IN', 'TOOL_SPECIFIC', 'TOOL_AGNOSTIC', 'DOMAIN_WORKFLOW', 'USER_GENERATED');

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('CORE', 'CRM', 'EMAIL_SENDER', 'EMAIL_READER', 'LEAD_DATABASE', 'ENRICHMENT', 'SOCIAL', 'CALENDAR', 'PROJECT_MGMT', 'ANALYTICS', 'SEARCH', 'FINANCE', 'TRADING', 'CONTENT', 'COMMUNICATION', 'SECURITY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ORCHESTRATOR', 'WORKER', 'CRITIC');

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('API_KEY', 'OAUTH_COMPOSIO', 'CHANNEL_NATIVE');

-- CreateEnum
CREATE TYPE "ToolConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'EXPIRED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "CustomAuthType" AS ENUM ('API_KEY_HEADER', 'BEARER_TOKEN', 'BASIC_AUTH', 'QUERY_PARAM');

-- CreateEnum
CREATE TYPE "ClawCategory" AS ENUM ('MONEY_MAKING', 'CREATOR', 'BUSINESS_OPS', 'VERTICAL', 'LIFESTYLE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'GENERATING', 'PROVISIONING', 'CONFIGURING', 'STARTING', 'HEALTH_CHECK', 'WAITING_CHANNELS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('HEARTBEAT', 'TASK_START', 'TASK_COMPLETE', 'TASK_FAILED', 'REVIEW_PASS', 'REVIEW_REJECT', 'HUMAN_REQUEST', 'HUMAN_APPROVE', 'HUMAN_REJECT', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'SKILL_INVOKED', 'ERROR', 'SYSTEM', 'COST_ALERT', 'TRADE_SIGNAL', 'TRADE_RECOMMENDED', 'TRADE_EXECUTED', 'TRADE_CLOSED', 'TRADE_BLOCKED', 'CIRCUIT_BREAKER');

-- CreateEnum
CREATE TYPE "SnapshotTrigger" AS ENUM ('AUTO_SAVE', 'MANUAL_SAVE', 'PRE_DEPLOY', 'TEMPLATE_LOAD', 'USER_LABELED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_REGISTER', 'PASSWORD_CHANGE', 'API_KEY_ADDED', 'API_KEY_REMOVED', 'WORKSPACE_CREATED', 'WORKSPACE_UPDATED', 'WORKSPACE_DELETED', 'AGENT_CREATED', 'AGENT_UPDATED', 'AGENT_DELETED', 'AGENT_SOUL_UPDATED', 'AGENT_SKILLS_CHANGED', 'DEPLOYMENT_STARTED', 'DEPLOYMENT_COMPLETED', 'DEPLOYMENT_FAILED', 'DEPLOYMENT_ROLLED_BACK', 'CONTAINER_STARTED', 'CONTAINER_STOPPED', 'CONTAINER_RESTARTED', 'PURCHASE_MADE', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_CANCELED', 'PAYMENT_FAILED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'SKILL_VERIFIED', 'USER_SUSPENDED', 'TRADE_RECOMMENDED', 'TRADE_APPROVED_BY_HUMAN', 'TRADE_AUTO_EXECUTED', 'TRADE_REJECTED_BY_HUMAN', 'TRADE_LIMIT_REACHED', 'TRADE_CIRCUIT_BREAKER_TRIGGERED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "emailVerified" TIMESTAMP(3),
    "hashedPassword" TEXT,
    "stripeCustomerId" TEXT,
    "dodoCustomerId" TEXT,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "subscriptionId" TEXT,
    "subscriptionEndsAt" TIMESTAMP(3),
    "maxWorkspaces" INTEGER NOT NULL DEFAULT 1,
    "maxAgentsPerWorkspace" INTEGER NOT NULL DEFAULT 3,
    "monthlyApiSpendLimit" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "UserApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ApiProvider" NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "label" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'DRAFT',
    "deploymentType" "DeploymentType",
    "containerId" TEXT,
    "containerName" TEXT,
    "containerHost" TEXT,
    "containerPort" INTEGER,
    "hostPort" INTEGER,
    "gatewayToken" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "lastHealthCheck" TIMESTAMP(3),
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "channelConfigEncrypted" TEXT,
    "currentMonthApiCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "apiSpendLimit" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "costAlertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "costAlertSent" BOOLEAN NOT NULL DEFAULT false,
    "clawTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleDescription" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#5BA1F5',
    "icon" TEXT,
    "soulMd" TEXT NOT NULL,
    "agentsMd" TEXT NOT NULL,
    "heartbeatMd" TEXT,
    "toolsMd" TEXT,
    "userMd" TEXT,
    "identityMd" TEXT,
    "model" TEXT NOT NULL DEFAULT 'anthropic/claude-sonnet-4-6',
    "fallbackModel" TEXT,
    "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "role" "AgentRole" NOT NULL DEFAULT 'WORKER',
    "reportsTo" TEXT,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "qualityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkill" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "configOverrides" TEXT,

    CONSTRAINT "AgentSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "condition" "ConnectionCondition" NOT NULL DEFAULT 'ON_COMPLETE',
    "conditionExpr" TEXT,
    "label" TEXT,

    CONSTRAINT "AgentConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "skillMd" TEXT NOT NULL,
    "type" "SkillType" NOT NULL,
    "category" "SkillCategory" NOT NULL,
    "icon" TEXT,
    "compatibleTools" TEXT[],
    "requiresToolConnection" BOOLEAN NOT NULL DEFAULT false,
    "requiredToolCategory" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isCurated" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "permissions" TEXT[],
    "securityNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "toolSlug" TEXT NOT NULL,
    "connectionType" "ConnectionType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "keyHint" TEXT,
    "composioConnectionId" TEXT,
    "composioEntityId" TEXT,
    "status" "ToolConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomToolConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" "CustomAuthType" NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "description" TEXT,
    "generatedSkillMd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomToolConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClawTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ClawCategory" NOT NULL,
    "tags" TEXT[],
    "priceSetup" DOUBLE PRECISION NOT NULL,
    "priceMonthly" DOUBLE PRECISION NOT NULL,
    "agentCount" INTEGER NOT NULL,
    "previewImage" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "dodoProductId" TEXT,
    "dodoSupportProductId" TEXT,
    "workspaceSnapshot" TEXT NOT NULL,
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClawTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateReview" (
    "id" TEXT NOT NULL,
    "clawTemplateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "review" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clawTemplateId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripePaymentId" TEXT,
    "stripeInvoiceId" TEXT,
    "dodoPaymentId" TEXT,
    "dodoBusinessId" TEXT,
    "subscriptionId" TEXT,
    "subscriptionStatus" "SubscriptionStatus",
    "status" "PurchaseStatus" NOT NULL DEFAULT 'COMPLETED',
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "configSnapshot" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "containerId" TEXT,
    "containerImage" TEXT NOT NULL DEFAULT 'ghcr.io/openclaw/openclaw:latest',
    "containerHost" TEXT,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentName" TEXT,
    "agentSlug" TEXT,
    "action" TEXT NOT NULL,
    "actionType" "ActivityType" NOT NULL,
    "metadata" TEXT,
    "tokenCount" INTEGER,
    "apiCost" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" "SnapshotTrigger" NOT NULL,
    "label" TEXT,

    CONSTRAINT "WorkspaceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_dodoCustomerId_key" ON "User"("dodoCustomerId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_stripeCustomerId_idx" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "UserApiKey_userId_idx" ON "UserApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserApiKey_userId_provider_key" ON "UserApiKey"("userId", "provider");

-- CreateIndex
CREATE INDEX "Workspace_userId_idx" ON "Workspace"("userId");

-- CreateIndex
CREATE INDEX "Workspace_status_idx" ON "Workspace"("status");

-- CreateIndex
CREATE INDEX "Workspace_containerId_idx" ON "Workspace"("containerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_userId_slug_key" ON "Workspace"("userId", "slug");

-- CreateIndex
CREATE INDEX "Agent_workspaceId_idx" ON "Agent"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_workspaceId_agentSlug_key" ON "Agent"("workspaceId", "agentSlug");

-- CreateIndex
CREATE INDEX "AgentSkill_agentId_idx" ON "AgentSkill"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkill_agentId_skillId_key" ON "AgentSkill"("agentId", "skillId");

-- CreateIndex
CREATE INDEX "AgentConnection_workspaceId_idx" ON "AgentConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentConnection_sourceAgentId_idx" ON "AgentConnection"("sourceAgentId");

-- CreateIndex
CREATE INDEX "AgentConnection_targetAgentId_idx" ON "AgentConnection"("targetAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");

-- CreateIndex
CREATE INDEX "Skill_type_category_idx" ON "Skill"("type", "category");

-- CreateIndex
CREATE INDEX "Skill_category_idx" ON "Skill"("category");

-- CreateIndex
CREATE INDEX "ToolConnection_workspaceId_idx" ON "ToolConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolConnection_workspaceId_toolSlug_key" ON "ToolConnection"("workspaceId", "toolSlug");

-- CreateIndex
CREATE INDEX "CustomToolConnection_workspaceId_idx" ON "CustomToolConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClawTemplate_slug_key" ON "ClawTemplate"("slug");

-- CreateIndex
CREATE INDEX "ClawTemplate_category_idx" ON "ClawTemplate"("category");

-- CreateIndex
CREATE INDEX "ClawTemplate_featured_idx" ON "ClawTemplate"("featured");

-- CreateIndex
CREATE INDEX "TemplateReview_clawTemplateId_idx" ON "TemplateReview"("clawTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateReview_clawTemplateId_userId_key" ON "TemplateReview"("clawTemplateId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_stripePaymentId_key" ON "Purchase"("stripePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_dodoPaymentId_key" ON "Purchase"("dodoPaymentId");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_clawTemplateId_idx" ON "Purchase"("clawTemplateId");

-- CreateIndex
CREATE INDEX "Purchase_stripePaymentId_idx" ON "Purchase"("stripePaymentId");

-- CreateIndex
CREATE INDEX "Purchase_dodoPaymentId_idx" ON "Purchase"("dodoPaymentId");

-- CreateIndex
CREATE INDEX "Deployment_workspaceId_idx" ON "Deployment"("workspaceId");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_timestamp_idx" ON "ActivityLog"("workspaceId", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_agentSlug_idx" ON "ActivityLog"("workspaceId", "agentSlug");

-- CreateIndex
CREATE INDEX "ActivityLog_actionType_idx" ON "ActivityLog"("actionType");

-- CreateIndex
CREATE INDEX "WorkspaceSnapshot_workspaceId_version_idx" ON "WorkspaceSnapshot"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "WorkspaceSnapshot_workspaceId_createdAt_idx" ON "WorkspaceSnapshot"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_clawTemplateId_fkey" FOREIGN KEY ("clawTemplateId") REFERENCES "ClawTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkill" ADD CONSTRAINT "AgentSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_sourceAgentId_fkey" FOREIGN KEY ("sourceAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolConnection" ADD CONSTRAINT "ToolConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomToolConnection" ADD CONSTRAINT "CustomToolConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateReview" ADD CONSTRAINT "TemplateReview_clawTemplateId_fkey" FOREIGN KEY ("clawTemplateId") REFERENCES "ClawTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_clawTemplateId_fkey" FOREIGN KEY ("clawTemplateId") REFERENCES "ClawTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSnapshot" ADD CONSTRAINT "WorkspaceSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
