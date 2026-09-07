// lib/openclaw/generator.ts
// ============================================================================
// THE critical module. Converts Claws DB models into OpenClaw workspace
// files that the OpenClaw runtime can actually read and execute.
//
// VALIDATED AGAINST: OpenClaw codebase (March 2026)
// Key findings incorporated:
//   1. Each agent gets its OWN flat workspace dir (not nested under a parent)
//   2. AGENTS.md = per-agent operating instructions (NOT multi-agent definitions)
//   3. Multi-agent defined via agents.list[] in openclaw.json
//   4. Orchestrator→Worker communication via sessions_spawn (NOT sessions_send)
//   5. No reportsTo - hierarchy is depth-based via spawn depth
//   6. No CONNECTED_TOOLS.md - tool info goes in TOOLS.md + skill SKILL.md
//   7. Skills loaded on-demand by agent (only catalog in system prompt)
//   8. openclaw.json validated with strict Zod schema (no unknown keys!)
//   9. Workspace .md files have ZERO validation (any UTF-8 text works)
//  10. Model strings require provider/ prefix (e.g. "anthropic/claude-sonnet-4-6")
// ============================================================================

import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/encryption';
import { log } from '@/lib/logger';
import { generateSecureToken } from '@/lib/crypto';
import { getToolBySlug } from '@/data/tool-catalog';
import { getComposio, getComposioUserId } from '@/lib/composio';
import {
  classifyToolkitAuthMode,
  createBYOKConnectedAccount,
  fetchToolkitWithAuthMode,
  resolveToolkitBYOKAuthScheme,
  type BYOKCredentialInput,
} from '@/lib/composio-auth-config';
import {
  isMcpLongtailEnabled,
  resolveToolRouterSession,
  mergeMcpDenyIntoAgentTools,
} from '@/lib/openclaw/mcp-longtail';
import { mergeDirListDenyIntoTools } from '@/lib/openclaw/dir-list-deny';
import {
  buildMessageDeliverySection,
  mergeMessageDenyIntoTools,
} from '@/lib/openclaw/message-delivery';
import { CLAIMS_TABLE_STEP_MARKER, STRICT_8_DEFINITION } from '@/lib/critic/claims-table';
import { CRITIC_NE_HUMAN_COPY, mergeOutboundDenyIntoTools, overlayMissionLaw, TOOL_STATUS_TRUTH_COPY } from '@/lib/openclaw/delivery-rail';
import {
  collectAttachedSkillSlugs,
  disableBundledWebSearch,
  mergeSkillShadowDenyIntoTools,
} from '@/lib/openclaw/skill-shadow-deny';
import { QUANT_TEMPLATE_SLUG, quantContainerEnvLines } from '@/lib/quant/risk-limits';
import { reprobeWorkspaceToolConnections } from '@/lib/tools/reprobe-on-deploy';
import { deriveCustomApiIdentities } from '@/lib/custom-api-identity';
import {
  buildChannelEnvVars,
  buildOpenClawChannelsConfig,
  configuredChannelIds,
  parseChannelConfigBlob,
  type ChannelConfigMap,
} from '@/lib/openclaw/channel-config';
import { buildCronJobsFromHeartbeatMd } from '@/lib/openclaw/heartbeat-md-cron';
import { deserializeSchedule, emitHeartbeatJobs } from '@/lib/schedule';
import { getApiKeySource } from '@/lib/credits/api-key-source';
import { isThinkingLevel } from '@/lib/models/thinking';
import { ANTHROPIC_PROXY_URL } from '@/lib/openclaw/derive-container-env';
import { deriveAllowAgents } from '@/lib/openclaw/derive-allow-agents';
import {
  expandSeedFilesForAgents,
  resolveWorkspaceSeedFiles,
} from '@/lib/workspace-seed-files';
import {
  formatInterviewBootSection,
  getInterviewPack,
  USER_MD_HOST_PATH,
} from '@/lib/user-md-interview';
import {
  WORKFLOW_FENCE_BEGIN,
  applyWorkflowFence,
  generateFencedWorkflowSection,
  type WorkflowDeliveryMode,
} from '@/lib/openclaw/workflow-language';
import { twitterApiToolsMdHonestyLines } from '@/lib/tools/twitter-api-honesty';
import { httpContractForSkill } from '@/lib/openclaw/skill-http-contracts';
import { rewriteSkillMdForHttp } from '@/lib/openclaw/skill-http-md';
import { httpHonestStatusLabel } from '@/lib/openclaw/skill-http-status';
import { FAIL_CLOSED_PINNED_IMAGE } from '@/lib/openclaw/http-image-profiles';
import type { ApiKeySource } from '@/generated/prisma/client';
import yaml from 'yaml';

/** Catalog slugs that can back OpenClaw's built-in web_search tool. */
export const SEARCH_BACKEND_TOOL_SLUGS = [
  'tavily',
  'brave_search',
  'exa_search',
  'serp_api',
] as const;

/**
 * True when the workspace has a CONNECTED search-category tool from the
 * known slug set. We do not currently emit tools.web.search provider/apiKey
 * for these connections (skills.entries only) - see dead-tool honesty.
 */
export function workspaceHasSearchBackend(
  workspace: { toolConnections: Array<{ toolSlug: string; status: string }> },
): boolean {
  return workspace.toolConnections.some(
    (tc) =>
      tc.status === 'CONNECTED' &&
      (SEARCH_BACKEND_TOOL_SLUGS as readonly string[]).includes(tc.toolSlug),
  );
}

// ---------------------------------------------------------------------------
// Composio constants (OAUTH_COMPOSIO emission)
// ---------------------------------------------------------------------------
// The REST endpoint every skillMd body targets at runtime for Composio-proxied
// OAuth tools (option iv, per docs/COMPOSIO_RUNTIME_CONTRACT.md). Emitted
// into openclaw.json > skills.entries[<slug>].config.composio.executeEndpoint
// so skill bodies read it from env/config rather than hard-coding.
//
// The SDK (`@composio/core` → `@composio/client`) canonically targets /api/v3/.
// A /api/v3.1/ variant also exists but is OpenAPI-only; both accept the same
// payload shape. See docs/COMPOSIO_RUNTIME_CONTRACT.md §"Endpoint path drift".
const COMPOSIO_EXECUTE_ENDPOINT = 'https://backend.composio.dev/api/v3/tools/execute';

type JsonObject = Record<string, unknown>;

type ScheduledTaskConfig = {
  name?: string;
  schedule: string;
  timezone?: string;
  agentSlug?: string;
  agentId?: string;
  targetAgentSlug?: string;
  isolated?: boolean;
  urgent?: boolean;
  prompt: string;
  fullContext?: boolean;
  channelDelivery?: {
    channel: string;
  };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The complete set of files the generator produces for a workspace deployment.
 * This maps directly to the container filesystem at /home/node/.openclaw/
 */
export interface GeneratedWorkspace {
  /** /home/node/.openclaw/openclaw.json - Gateway + agent config (STRICT Zod validation) */
  'openclaw.json': string;

  /** /home/node/.openclaw/.env - API keys, channel tokens (dotenv format) */
  '.env': string;

  /** Per-agent workspace directories: workspace-{agentId}/... */
  workspaces: Record<string, AgentWorkspaceFiles>;

  /** /home/node/.openclaw/cron/jobs.json - Scheduled tasks */
  'cron/jobs.json': string;

  /** Gateway auth token (stored encrypted in our DB for monitoring connections) */
  gatewayToken: string;

  /** True when a stale/tampered orchestrator workflow fence was regenerated. */
  workflowFenceCorrected?: boolean;

  /**
   * INFRA-2 birth stubs unpacked IF-ABSENT (not mixed into CLAWS_FILES).
   * Keys are paths under /home/node/.openclaw/
   * (shared/VOICE.md once; workspace-{id}/memory/MEMORY.md per agent).
   */
  seedFiles?: Record<string, string>;
}

export interface AgentWorkspaceFiles {
  'SOUL.md': string;
  'AGENTS.md': string;
  'USER.md': string;
  'IDENTITY.md': string;
  'TOOLS.md': string;
  'HEARTBEAT.md': string;
  'BOOT.md': string;
  skills: Record<string, { 'SKILL.md': string }>;
}

// ---------------------------------------------------------------------------
// Model Mapping
// ---------------------------------------------------------------------------

/**
 * Maps our DB model enum to OpenClaw's provider/model-version format.
 * OpenClaw expects "provider/model-id" strings.
 * The auth storage layer auto-discovers API keys from env vars
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 */
const MODEL_MAP: Record<string, string> = {
  // Anthropic
  'HAIKU_4_5':  'anthropic/claude-haiku-4-5-20251001',
  'SONNET_4_6': 'anthropic/claude-sonnet-4-6',
  'OPUS_4_6':   'anthropic/claude-opus-4-6',
  // OpenAI (if user provides key)
  'GPT_4O':       'openai/gpt-4o',
  'GPT_4O_MINI':  'openai/gpt-4o-mini',
  // Google (if user provides key)
  'GEMINI_2_5_PRO':   'google/gemini-2.5-pro',
  'GEMINI_2_5_FLASH': 'google/gemini-2.5-flash',
};

function resolveModel(dbModel: string): string {
  // Already in provider/model format - pass through
  if (dbModel.includes('/')) return dbModel;
  // Legacy enum format (HAIKU_4_5 etc.)
  if (MODEL_MAP[dbModel]) return MODEL_MAP[dbModel];
  // Bare model name fallback
  return `anthropic/${dbModel.toLowerCase().replace(/_/g, '-')}`;
}

// ---------------------------------------------------------------------------
// Agent ID Utils
// ---------------------------------------------------------------------------

/**
 * Converts agent name to a valid OpenClaw agent ID.
 * OpenClaw normalizes agent IDs to lowercase alphanumeric + hyphens.
 */
export function toAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * First-deploy gateway-token claim. Exactly one token may ever be persisted
 * for a workspace: the conditional updateMany only lands when the column is
 * still null, and every caller then re-reads and uses whatever is persisted -
 * so concurrent deploys all bake the SAME token into their container env.
 */
export async function claimGatewayToken(workspaceId: string): Promise<string> {
  const fresh = generateSecureToken();
  await prisma.workspace.updateMany({
    where: { id: workspaceId, gatewayToken: null },
    data: { gatewayToken: encrypt(fresh) },
  });
  const row = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { gatewayToken: true },
  });
  // Null only if a concurrent writer cleared the column between the claim and
  // the re-read; fall back to our mint so generation still succeeds.
  return row.gatewayToken ? decrypt(row.gatewayToken) : fresh;
}

export async function generateWorkspace(workspaceId: string): Promise<GeneratedWorkspace> {
  // Re-probe API_KEY connections so TOOLS.md status is last-probe, not a
  // stale DEGRADED story from a prior window / recharge.
  try {
    await reprobeWorkspaceToolConnections(workspaceId);
  } catch (err) {
    log.warn('tool re-probe on generate failed; baking last known status', {
      category: 'tool_validation',
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 1. Load full workspace graph from DB
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: {
      agents: {
        include: {
          skills: { include: { skill: true } },
          outgoingConnections: { include: { targetAgent: true } },
          incomingConnections: { include: { sourceAgent: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      toolConnections: true,
      customToolConnections: { orderBy: { createdAt: 'asc' } },
      clawTemplate: true,
      // D6 2026-08-23 webchat-silent: the setup wizard's per-workspace "Add
      // key" writes WorkspaceApiKey rows and the deploy gate counts them as
      // an auth path - so the generator MUST bake them too, or the container
      // fails every turn with 'No API key found for provider ...'.
      apiKeyOverrides: true,
      user: {
        include: {
          apiKeys: true,
        },
      },
    },
  });

  // 2. Parse channel config from encrypted JSON blob. The plaintext contract
  // is a runtime-shaped map keyed by OpenClaw channel id; see
  // src/lib/openclaw/channel-config.ts. Invalid blobs are treated as no
  // channels so one bad optional integration cannot prevent a deploy.
  let channelConfig: ChannelConfigMap = {};
  if (workspace.channelConfigEncrypted) {
    try {
      channelConfig = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt);
    } catch {
      channelConfig = {};
    }
  }

  // 2b. Pre-load skills compatible with any connected tool in this
  // workspace. Kept separate from the main include because Skill is not a
  // direct Workspace relation - the tool→skill map lives on
  // Skill.compatibleTools. Loading here (once, before any sync config
  // generator runs) keeps generateSkillsEntriesConfig pure-sync and testable
  // without async plumbing. When no tools are connected, we skip the query.
  //
  // C-engine B1: widened from OAuth-only to ALL emission-eligible connected
  // tool slugs so the OAuth branch (curated skills.entries emission) and the
  // API_KEY branch (uncurated long-tail detection) share ONE lookup. The
  // eligibility filters mirror each branch's own emission guards.
  const connectedToolSlugs = workspace.toolConnections
    .filter(
      (tc) =>
        (tc.connectionType === 'OAUTH_COMPOSIO' && tc.status === 'CONNECTED') ||
        (tc.connectionType === 'NO_AUTH' && tc.status === 'CONNECTED') ||
        isApiKeyToolEmitEligible(tc),
    )
    .map((tc) => tc.toolSlug);

  const compatibleToolSkills: SkillForToolEmit[] =
    connectedToolSlugs.length > 0
      ? await prisma.skill.findMany({
          where: { compatibleTools: { hasSome: connectedToolSlugs } },
          select: { slug: true, compatibleTools: true },
        })
      : [];

  const workspaceWithChannels = { ...workspace, channelConfig, compatibleToolSkills };

  // 3. Identify agent roles
  const orchestrator = workspaceWithChannels.agents.find(a => a.role === 'ORCHESTRATOR');
  const critic = workspaceWithChannels.agents.find(a => a.role === 'CRITIC');
  const workers = workspaceWithChannels.agents.filter(a => a.role === 'WORKER');
  const activeWorkers = workers.filter((worker) => !worker.isPaused);

  if (!orchestrator) throw new Error(`Workspace ${workspaceId} has no Orchestrator agent`);
  if (!critic) throw new Error(`Workspace ${workspaceId} has no Critic agent`);

  // 3. Gateway token for platform↔container communication.
  //
  // Reuse when present: rotating on every redeploy adds no practical security
  // benefit, but it creates a split-brain window (container env vs DB) and
  // breaks paired dashboard-chat devices. Explicit token rotation can be a
  // future operator action. A workspace that already drifted self-heals on its
  // next redeploy because the DB token is baked back into the container env.
  //
  // First deploy mints via an ATOMIC claim, not a bare read-then-mint. D6
  // incident 2026-08-22 (ws cmt14iixu000004lcaeqvea04): two deploys started
  // 13s apart, both read gatewayToken=null, each minted a DIFFERENT token,
  // and the losing token ended up in the running container while the winner
  // landed in the DB - every health probe then 401'd (bad-token) and the
  // dashboard showed "running an older configuration" on a fresh deploy.
  // The claim guarantees all concurrent deploys converge on ONE persisted
  // token. MUTATION: restoring the bare generateSecureToken() mint revives
  // the split-brain race.
  const gatewayToken = workspace.gatewayToken
    ? decrypt(workspace.gatewayToken)
    : await claimGatewayToken(workspaceId);

  // 4. Resolve heartbeat once. Every mode emits cron/jobs.json (croner-shaped)
  //    so preview and runtime share one parser. When Builder frequency is
  //    unset, template schedules embedded as HEARTBEAT.md `cron: "..."` lines
  //    become machine truth via the same jobs.json path (OpenClaw -9 cron store
  //    reads jobs.json only - MD is prose the agent reads when a job fires).
  //    See resolveHeartbeatSchedule.
  //
  // PR-2b #8 + #9: orchestrator's slugified agent id is threaded into the
  // cron emit so the emitted job carries `id` (required by OpenClaw cron
  // store load), `agentId` (explicit routing target), and the correct
  // `sessionTarget` shape (`session:agent:<slug>:main`, NOT the literal
  // "main" which is reserved for systemEvent payloads). We use
  // `toAgentId(orchestrator.name)` instead of reading
  // `orchestrator.agentSlug` directly - both resolve to the same value
  // for current rows (slug stored at create-time by route.ts via the
  // same slugifier) but `toAgentId(name)` is the same source-of-truth
  // the rest of this generator uses (see agentsList build below at
  // generator.ts:252), so any future drift between the stored slug and
  // the slug emitted into openclaw.json's agents.list is impossible.
  const orchestratorAgentSlug = toAgentId(orchestrator.name);
  const heartbeat = resolveHeartbeatSchedule(
    orchestrator.heartbeatFrequency,
    orchestrator.heartbeatTime,
    workspaceWithChannels.timezone,
    orchestratorAgentSlug,
    orchestrator.heartbeatMd,
  );

  const composioApiKeyForMcp = process.env.COMPOSIO_API_KEY?.trim();
  if (isMcpLongtailEnabled() && composioApiKeyForMcp) {
    await lazyBackfillUncuratedLocalKeyConnections(workspaceWithChannels, workspaceId);
  }

  // 5. Skills entries + uncurated long-tail detection (C-engine B1).
  // Hoisted out of generateOpenClawConfig because the uncurated set drives
  // an async step (Tool Router session reuse-or-create) that must run
  // before the sync config assembly.
  const skillsEmission = generateSkillsEntriesConfig(workspaceWithChannels);
  const customApiSkillEntries = generateCustomApiSkillsEntries(workspaceWithChannels);
  const skillsEntries = {
    ...skillsEmission.entries,
    ...customApiSkillEntries,
  };

  // 5b. Tool Router session for the uncurated long-tail (flag-gated).
  // Quiet no-op when the flag is off, nothing is uncurated, or
  // COMPOSIO_API_KEY is unset - mirrors the OAuth branch's unconfigured
  // behavior. Runs INSIDE generateWorkspace so deploy AND redeploy both
  // flow through the same reuse-or-create (deployer.ts deployToCloud and
  // redeployWorkspace both call generateWorkspace).
  //
  // Session-resolution failure (Composio down at deploy time) is
  // non-fatal: warn and deploy without the mcp block. The runtime side is
  // graceful either way (Probe 3 step 7); a later redeploy re-attempts.
  let mcpEmission: McpEmission | null = null;
  if (
    isMcpLongtailEnabled() &&
    skillsEmission.uncuratedToolSlugs.length > 0 &&
    composioApiKeyForMcp
  ) {
    try {
      const session = await resolveToolRouterSession({
        userId: workspace.user.id,
        storedSessionId: workspace.composioToolRouterSessionId ?? null,
        toolkits: skillsEmission.uncuratedToolSlugs.map((slug) => getToolBySlug(slug)?.composioToolkitId ?? slug),
        connectedAccounts: skillsEmission.uncuratedToolConnectedAccounts,
      });
      if (session) {
        if (session.sessionId !== workspace.composioToolRouterSessionId) {
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { composioToolRouterSessionId: session.sessionId },
          });
        }
        mcpEmission = { url: session.mcpUrl, apiKey: composioApiKeyForMcp };
      }
    } catch (err) {
      console.warn(
        `[generator] Tool Router session resolution failed for workspace ${workspaceId}; deploying without mcp block (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // 6. Build all outputs.
  // PR-2b #10: orchestrator agent slug also threaded into generateCronJobs
  // so the scheduledTasks emit path (currently dormant - no Prisma column -
  // but kept fixed to avoid landing the same latent bug for a future
  // feature) uses the correct cron job shape too.
  const openclawConfig = generateOpenClawConfig(
    workspaceWithChannels,
    orchestrator,
    workers,
    critic,
    heartbeat,
    skillsEntries,
    mcpEmission,
  );
  const envFile = generateEnvFile(workspaceWithChannels, gatewayToken);
  const cronJobs = generateCronJobs(workspaceWithChannels, heartbeat, orchestratorAgentSlug, activeWorkers);
  const stableImage = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    orderBy: { releasedAt: 'desc' },
    select: { dockerImage: true },
  });
  const pinnedDockerImage = stableImage?.dockerImage ?? FAIL_CLOSED_PINNED_IMAGE;
  const workspaceFiles = generateAllWorkspaceFiles(
    workspaceWithChannels,
    orchestrator,
    workers,
    critic,
    mcpEmission !== null,
    pinnedDockerImage,
  );

  const logicalSeeds = resolveWorkspaceSeedFiles({
    seedFiles: workspaceWithChannels.seedFiles,
    clawTemplateSnapshot: workspaceWithChannels.clawTemplate?.workspaceSnapshot,
  });
  const seedFiles = expandSeedFilesForAgents(
    logicalSeeds,
    [orchestrator, ...workers, critic].map((agent) => `workspace-${toAgentId(agent.name)}`),
  );

  return {
    'openclaw.json': JSON.stringify(openclawConfig, null, 2),
    '.env': envFile,
    workspaces: workspaceFiles.workspaces,
    'cron/jobs.json': JSON.stringify(cronJobs, null, 2),
    gatewayToken,
    workflowFenceCorrected: workspaceFiles.workflowFenceCorrected,
    seedFiles,
  };
}

// ---------------------------------------------------------------------------
// openclaw.json Generation
// ---------------------------------------------------------------------------
// THIS FILE IS STRICTLY VALIDATED by OpenClaw's Zod schema.
// Rules:
//   - .strict() objects: unknown keys cause validation failure
//   - agents.list[].id is the ONLY required field per agent
//   - Empty {} is valid (but useless)
// ---------------------------------------------------------------------------

/**
 * C-engine B1: coordinates for the emitted `mcp.servers.composio` block.
 * Non-null only when the workspace has uncurated connected tools, the
 * CLAWS_MCP_LONGTAIL_ENABLED flag is on, and a Tool Router session resolved.
 */
interface McpEmission {
  url: string;
  apiKey: string;
}

function generateOpenClawConfig(
  workspace: WorkspaceWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  heartbeat: HeartbeatScheduleResult | null,
  skillsEntries: Record<string, unknown>,
  mcpEmission: McpEmission | null,
) {
  const activeWorkers = workers.filter((worker) => !worker.isPaused);
  const runtimeAgents = [orchestrator, ...activeWorkers, critic];
  const allowAgentDerivation = deriveAllowAgents({
    agents: [orchestrator, ...workers, critic],
    edges: orchestrator.outgoingConnections.map((conn) => ({
      sourceAgentId: orchestrator.id,
      targetAgentId: conn.targetAgent.id,
    })),
  });
  const customApiSkillSlugs = Array.from(
    deriveCustomApiIdentities(workspace.customToolConnections ?? []).values(),
  ).map((identity) => identity.slug);
  const attachedSkillSlugs = collectAttachedSkillSlugs(workspace);

  // Build agents.list - one entry per agent in the Claw
  const agentsList = runtimeAgents.map(agent => {
    const agentId = toAgentId(agent.name);
    const isOrchestrator = agent.role === 'ORCHESTRATOR';

    const entry: JsonObject = {
      id: agentId,
      name: agent.name,
      // Each agent gets its own workspace directory
      // OpenClaw resolves these relative to OPENCLAW_STATE_DIR
      workspace: `/home/node/.openclaw/workspace-${agentId}`,
      model: resolveModel(agent.model),
    };

    // Per-agent thinking effort → agents.list[].thinkingDefault (runtime-native
    // key, levels off|minimal|low|medium|high). null/invalid → omit so the
    // runtime default applies. Models without reasoning ignore it at run time.
    if (isThinkingLevel(agent.thinkingDefault)) {
      entry.thinkingDefault = agent.thinkingDefault;
    }

    if (isOrchestrator) {
      // `default: true` is THE routing mechanism: OpenClaw's route resolution
      // falls back to the default agent for any inbound traffic without an
      // exact-channel binding, so all channel/webchat messages land on the
      // Orchestrator. (A channel:'*' binding does NOT do this - see the
      // comment at the config assembly below and #117.)
      entry.default = true;
      // Allow orchestrator to spawn workers and critic as subagents.
      // Do NOT set subagents.model - that latent default overrides the target
      // worker's list model when sessions_spawn omits agentId (self-target →
      // commander model). requireAgentId forces explicit worker selection.
      entry.subagents = {
        allowAgents: allowAgentDerivation.allowAgents,
        requireAgentId: true,
      };
    }

    // Per-agent skill filtering: only show relevant skills to each agent
    const agentSkillSlugs = Array.from(new Set([
      ...agent.skills.map(as => as.skill.slug),
      ...customApiSkillSlugs,
    ]));
    if (agentSkillSlugs.length > 0) {
      entry.skills = agentSkillSlugs;
    }

    // C-engine B1 token-tax scoping: in an MCP-enabled workspace, only the
    // Orchestrator carries the Router's tool definitions. Every other agent
    // denies `composio__*` - the runtime's allowlist gate then skips the
    // bundle-MCP runtime entirely for those agents' runs (verified against
    // upstream v2026.5.22 dist: shouldCreateBundleMcpRuntimeForAttempt +
    // makeToolPolicyMatcher glob deny). Merge, never clobber, any existing
    // tools policy on the entry.
    if (mcpEmission && !isOrchestrator) {
      entry.tools = mergeMcpDenyIntoAgentTools(entry.tools as Record<string, unknown> | undefined);
    }

    entry.tools = mergeOutboundDenyIntoTools(
      entry.tools as Record<string, unknown> | undefined,
      workspace.deliveryMode === 'AUTO_PROCEED' ? 'AUTO_PROCEED' : 'APPROVAL_REQUIRED',
    );

    entry.tools = mergeSkillShadowDenyIntoTools(
      entry.tools as Record<string, unknown> | undefined,
      attachedSkillSlugs,
    );

    return entry;
  });

  // Heartbeat config - only the orchestrator runs heartbeats.
  // All modes emit cron/jobs.json (shared croner path). agents.defaults.heartbeat
  // is left unset so the gateway interval runner cannot disagree with croner.
  const heartbeatInterval = heartbeat?.intervalConfig;

  // Channel config - from setup wizard step 4
  const channelsConfig = generateChannelsConfig(workspace);

  // Build allowed origins for the Control UI
  const allowedOrigins = [
    'http://localhost:18789',
    'http://127.0.0.1:18789',
  ];
  if (workspace.containerHost) {
    allowedOrigins.push(`https://${workspace.containerHost}`);
  }

  // Build the final config - ONLY use fields that exist in OpenClaw's Zod schema
  const config: JsonObject = {
    gateway: {
      mode: 'local',
      bind: 'lan',  // Required for Docker (0.0.0.0)
      port: 18789,
      controlUi: {
        allowedOrigins,
      },
    },
    agents: {
      defaults: {
        model: resolveModel(orchestrator.model),
        heartbeat: heartbeatInterval,
        subagents: {
          // Increase max children for larger Claws (default is 5)
          maxChildrenPerAgent: Math.max(5, activeWorkers.length + 1),
          maxSpawnDepth: 2,
        },
      },
      list: agentsList,
    },
    // NO `bindings` key - deliberately (#117). We previously emitted
    // `bindings: [{ agentId: <orchestrator>, match: { channel: '*' } }]`
    // believing it routed all channel traffic to the Orchestrator. It was a
    // no-op: OpenClaw's binding index is an exact-string map keyed by channel
    // name (upstream src/routing/resolve-route.ts @ v2026.5.22), so
    // channel:'*' only matches a channel literally named "*". Routing to the
    // Orchestrator actually works because it carries `default: true` in
    // agents.list (route resolution falls back to the default agent). See
    // docs/OPENCLAW_GATEWAY_PROTOCOL.md §4 and §8 risk 2.
  };

  // Add channels if any are configured
  if (Object.keys(channelsConfig).length > 0) {
    config.channels = channelsConfig;
  }

  // Add skill entries if any tools have credentials
  if (Object.keys(skillsEntries).length > 0) {
    config.skills = { entries: skillsEntries };
  }

  // Dead-tool honesty: when no search backend is configured, disable the
  // built-in web_search tool (createWebSearchTool returns null when
  // tools.web.search.enabled === false). Connecting a SEARCH catalog tool
  // today only emits skills.entries[<slug>] - it does NOT wire
  // tools.web.search provider/apiKey. So "backend present" here means we
  // leave web_search enabled (agent may still fail at call time until a
  // future PR wires provider config); "backend absent" means we disable it.
  if (!workspaceHasSearchBackend(workspace)) {
    config.tools = {
      ...(typeof config.tools === 'object' && config.tools && !Array.isArray(config.tools)
        ? (config.tools as Record<string, unknown>)
        : {}),
      web: {
        search: { enabled: false },
      },
    };
  }

  // Lifecycle P6: deny dir_list-class file tools until paired nodes exist.
  // Honest tool-policy error instead of upstream "unknown node: gateway" boot noise.
  config.tools = mergeDirListDenyIntoTools(
    typeof config.tools === 'object' && config.tools && !Array.isArray(config.tools)
      ? (config.tools as Record<string, unknown>)
      : undefined,
  );

  // D6-b: zero external channels → deny the `message` tool globally. Webchat
  // replies ride the normal turn reply (no channel needed), so here the tool
  // can only fail - and its runtime error tells the HUMAN to run
  // "openclaw channels add", which the model parrots into the chat. Denied
  // tools are filtered out of the model's tool list entirely, so that CLI
  // text can never enter the context. Channel-connected claws keep the tool.
  if (configuredChannelIds(workspace.channelConfig).length === 0) {
    config.tools = mergeMessageDenyIntoTools(config.tools as Record<string, unknown>);
  }

  // B-3 delivery rail: outbound post/send/execute stay denied until the
  // human flips AUTO_PROCEED AND the tool opts into autonomous. Knob-as-prose
  // only is a mutation failure.
  config.tools = mergeOutboundDenyIntoTools(
    config.tools as Record<string, unknown>,
    workspace.deliveryMode === 'AUTO_PROCEED' ? 'AUTO_PROCEED' : 'APPROVAL_REQUIRED',
  );

  // Attached search skills replace bundled web_search. Deny the shadow so
  // agents cannot call kimi/web_search when tavily-search is on the claw.
  const toolsAfterShadow = mergeSkillShadowDenyIntoTools(
    config.tools as Record<string, unknown>,
    attachedSkillSlugs,
  );
  const shadowDeny = Array.isArray(toolsAfterShadow.deny)
    ? (toolsAfterShadow.deny as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  config.tools = shadowDeny.includes('web_search')
    ? disableBundledWebSearch(toolsAfterShadow)
    : toolsAfterShadow;

  // C-engine B1: MCP long-tail block (flag-gated; mcpEmission is only
  // non-null when CLAWS_MCP_LONGTAIL_ENABLED=true AND the workspace has
  // uncurated connected tools AND a Tool Router session resolved).
  //
  // SECRET-HANDLING NOTE: the x-api-key header is the SAME platform
  // COMPOSIO_API_KEY already emitted into this very file at
  // skills.entries[slug].env.COMPOSIO_API_KEY (above) and into the
  // container env by deployer.ts buildRailwayEnvVars - same
  // COMPOSIO_USER_ID scoping doctrine (see deployer.ts's Composio
  // coordinates block and docs/COMPOSIO_RUNTIME_CONTRACT.md). No new
  // secret material, no new delivery path. openclaw.json never leaves the
  // container: state-sync excludes it from every snapshot
  // (container/state-sync.mjs CONFIG_FILES). The upstream MCP runtime has
  // NO env interpolation in headers (verified against v2026.5.22 dist), so
  // a static value is the only option; the trs_ session URL is itself
  // pinned server-side to this workspace's user, which scopes execution
  // more tightly than the raw execute endpoint.
  if (mcpEmission) {
    config.mcp = {
      servers: {
        composio: {
          url: mcpEmission.url,
          transport: 'streamable-http',
          headers: { 'x-api-key': mcpEmission.apiKey },
        },
      },
    };
  }

  // Credit metering: route every anthropic/* model through the in-container
  // proxy. OpenClaw 2026.5.22-8 does NOT read process.env.ANTHROPIC_BASE_URL
  // for the messages client - it uses model.baseUrl, which
  // applyConfiguredProviderOverrides sets from
  // models.providers.<id>.baseUrl (dist model-cgt_Zkgh.js). Schema:
  // ModelsConfigSchema.providers → ModelProviderSchema.baseUrl
  // (zod-schema.core-D7Y_eqdd.js). anthropic is a built-in overlay id, so
  // models[] is optional. BYOK/NONE: omit - clients hit api.anthropic.com.
  // Credit metering: anthropic proxy only. OpenRouter is BYOK-only (no credit proxy).
  // When any agent uses openrouter/*, emit explicit provider overlay (baseUrl locked).
  const usesOpenRouter = runtimeAgents.some((a) =>
    (a.model || "").startsWith("openrouter/"),
  );
  const creditModeProviders =
    getApiKeySource(workspace, workspace.user) === "PLATFORM_CREDIT"
      ? { anthropic: { baseUrl: ANTHROPIC_PROXY_URL } }
      : null;

  if (creditModeProviders || usesOpenRouter) {
    config.models = {
      providers: {
        ...(creditModeProviders ?? {}),
        ...(usesOpenRouter
          ? {
              openrouter: {
                baseUrl: "https://openrouter.ai/api/v1",
                api: "openai-completions",
              },
            }
          : {}),
      },
    };
  }

  // PR-2: Claws Activity Reporter plugin (overlay baked into the Docker
  // image at /opt/claws-activity-reporter - see docker/Dockerfile + the
  // plugin source at container/claws-activity-reporter/). Always emit;
  // every workspace needs the reporter.
  //
  // Schema verified against upstream v2026.5.22:
  //   - plugins.load.paths: z.array(z.string()).optional()
  //       (zod-schema.ts:1167-1172, .strict())
  //   - plugins.entries.<id>: PluginEntrySchema with enabled?: boolean,
  //       hooks?: { allowConversationAccess?: boolean, ... }, etc.
  //       (zod-schema.ts:235-264, .strict())
  // The strict() wrapper means any unknown key would fail validation, so
  // do NOT add fields inside `entries.claws-activity-reporter` beyond the
  // PluginEntrySchema-allowed set.
  //
  // PR-2b #4: `hooks.allowConversationAccess: true` is REQUIRED here. The
  // upstream plugin sandbox blocks `before_agent_run` and `agent_end` hook
  // registrations from non-bundled plugins UNLESS this opt-in is set
  // (per types.plugins.ts comment: "Controls access to raw conversation
  // content from conversation hooks including before_agent_run, ..., and
  // agent_end"). Without this, the plugin loads but TASK_START /
  // TASK_COMPLETE / TASK_FAILED never reach ActivityLog - observed in the
  // staging boot log as: "[gateway] [plugins] typed hook \"before_agent_run\"
  // blocked because non-bundled plugins must set
  // plugins.entries.claws-activity-reporter.hooks.allowConversationAccess=true".
  // Our plugin only USES conversation hooks for observation (build a record,
  // push to buffer, return) - it does NOT mutate prompts or read raw
  // model output. Granting access is appropriate for the activity-tracking
  // use case.
  // PR-3: admin-http-rpc is a BUNDLED OpenClaw extension (ships at
  // extensions/admin-http-rpc/ in the upstream image - NOT an overlay
  // we COPY in via Dockerfile). It is off by default upstream. We enable
  // it here so the host's health-monitor cron can call
  //   POST https://{containerHost}/api/v1/admin/rpc
  //   Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}
  //   body: { "method": "health" }
  // The plugin's configSchema declares
  // `{ properties: {}, additionalProperties: false }`, so `{ enabled: true }`
  // is the entire permitted config - any other field would fail the
  // openclaw.json strict() validation and the gateway would refuse to boot.
  config.plugins = {
    load: { paths: ['/opt/claws-activity-reporter', '/opt/claws-http'] },
    entries: {
      'claws-activity-reporter': {
        enabled: true,
        hooks: { allowConversationAccess: true },
      },
      'claws-http': {
        enabled: true,
      },
      'admin-http-rpc': {
        enabled: true,
      },
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// Channel Config Generation
// ---------------------------------------------------------------------------
// Channels are configured in openclaw.json under the `channels` key.
// Tokens are passed via env vars (not hardcoded in config).
// OpenClaw auto-discovers tokens from TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, etc.
// ---------------------------------------------------------------------------

function generateChannelsConfig(workspace: WorkspaceWithRelations): JsonObject {
  return buildOpenClawChannelsConfig(workspace.channelConfig);
}

// ---------------------------------------------------------------------------
// Skills Entries Config (API keys for tools)
// ---------------------------------------------------------------------------
// Per-skill credentials and env vars live in openclaw.json skills.entries.
// This is how connected tools (HubSpot, Binance, etc.) get their API keys.
// The skill's eligibility check verifies the env var exists before including
// the skill in the catalog.
// ---------------------------------------------------------------------------

/**
 * Build `openclaw.json > skills.entries` from the user's ToolConnection rows.
 *
 * Emits two kinds of entries:
 *
 *   1. **API_KEY** (keyed by `toolSlug`):
 *      For each API_KEY ToolConnection with a populated `encryptedCredentials`
 *      column, decrypt the JSON payload (a `Record<envVar, value>`) and emit
 *      `skills.entries[toolSlug] = { enabled: true, env: <decrypted record> }`.
 *      Skipped when `status === 'NEEDS_CREDENTIALS'` (partial data) or the
 *      column is null/unparseable. Slot key matches the tool slug - the
 *      catalog slug is the skill name for tool-backed API_KEY skills.
 *
 *   2. **OAUTH_COMPOSIO** (keyed by `skillSlug`):
 *      For each CONNECTED OAUTH_COMPOSIO ToolConnection, look up every
 *      `Skill` whose `compatibleTools` array contains the tool slug (from
 *      `workspace.compatibleToolSkills`, pre-loaded in `generateWorkspace`)
 *      and emit one `skills.entries[skill.slug]` per compatible skill. Each
 *      entry carries the three Composio coordinates in `env`
 *      (`COMPOSIO_API_KEY`, `COMPOSIO_USER_ID`, `COMPOSIO_CONNECTED_ACCOUNT_ID`)
 *      plus `config.composio.{toolkit, executeEndpoint}` so the skill body can
 *      call Composio's REST endpoint at runtime. See
 *      docs/COMPOSIO_RUNTIME_CONTRACT.md §"Emission shape" for the canonical
 *      contract and the rationale for option (iv) per-request proxy.
 *      Skipped when `process.env.COMPOSIO_API_KEY` is unset (quiet no-op -
 *      builder/local-dev flows without Composio still succeed), when the
 *      row has no `composioConnectionId`, when the tool is not in the
 *      catalog, or when no Skill row has the tool in its `compatibleTools`.
 *
 * Skipped (across both branches):
 *   - `connectionType === 'CHANNEL_NATIVE'` (tokens live in .env, not here).
 *   - Decrypt/parse failures on API_KEY rows (logged, row skipped; a
 *     partial workspace is less harmful than a crashed generator).
 *
 * C-engine B1 return-contract change: alongside `entries`, this now
 * reports the UNCURATED connections - connected tools with no matching
 * Skill row (the long-tail):
 *   - `uncuratedToolSlugs`: OAUTH_COMPOSIO rows (Composio holds the
 *     credential → Tool Router CAN execute them). These drive the mcp
 *     block emission.
 *   - `uncuratedToolConnectedAccounts`: Composio toolkit slug → connected
 *     account id for those same rows. B1.1: Tool Router sessions MUST bind
 *     the accounts explicitly; the default auth-config lookup does not
 *     reliably resolve accounts provisioned through our OAuth flow.
 *   - `uncuratedLocalKeySlugs`: API_KEY rows whose credential lives in OUR
 *     DB. The Router cannot execute with keys it doesn't hold, so these
 *     are detected + warned but NOT mcp-emitted until B3 (API_KEY→BYOK
 *     routing) moves the keys to Composio.
 */
interface SkillsEmissionResult {
  entries: Record<string, unknown>;
  uncuratedToolSlugs: string[];
  uncuratedToolConnectedAccounts: Record<string, string>;
  uncuratedLocalKeySlugs: string[];
}

function hasCompatibleSkill(workspace: WorkspaceWithRelations, toolSlug: string): boolean {
  return workspace.compatibleToolSkills.some((s) => s.compatibleTools.includes(toolSlug));
}

/**
 * Same eligibility the deploy gate / wizard already use for credentialed
 * API_KEY rows: ciphertext present, CONNECTED or credentialed PENDING.
 * PENDING credentialed keys MUST emit - D6
 * taught us the gate-vs-generator seam for model keys; this is that seam
 * for the tool class. ERROR / EXPIRED / REVOKED / NEEDS_CREDENTIALS stay out
 * so TOOLS.md never says Connected when .env will not carry the key.
 */
export function isApiKeyToolEmitEligible(toolConn: {
  connectionType: string;
  status: string;
  encryptedCredentials: string | null;
}): boolean {
  return (
    toolConn.connectionType === 'API_KEY' &&
    Boolean(toolConn.encryptedCredentials) &&
    (toolConn.status === 'CONNECTED' || toolConn.status === 'PENDING')
  );
}

function parseLocalCredentialMap(toolConn: ToolConnectionRecord): Record<string, string> | null {
  if (!toolConn.encryptedCredentials) return null;
  try {
    const plaintext = decrypt(toolConn.encryptedCredentials);
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(
        `[generator] skipping tool ${toolConn.toolSlug}: encryptedCredentials plaintext is not a JSON object`,
      );
      return null;
    }

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) env[k] = v;
    }
    return Object.keys(env).length > 0 ? env : null;
  } catch (err) {
    console.warn(
      `[generator] skipping tool ${toolConn.toolSlug}: decrypt/parse failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

/** Flatten emit-eligible API_KEY ToolConnections into env-var → value. */
export function collectApiKeyToolEnv(
  toolConnections: ToolConnectionRecord[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const toolConn of toolConnections) {
    if (!isApiKeyToolEmitEligible(toolConn)) continue;
    const map = parseLocalCredentialMap(toolConn);
    if (!map) continue;
    Object.assign(env, map);
  }
  return env;
}

function parseCustomApiCredential(customConn: CustomToolConnectionRecord): string | null {
  try {
    const plaintext = decrypt(customConn.encryptedCredentials);
    const parsed = JSON.parse(plaintext);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as { credential?: unknown }).credential === 'string'
    ) {
      const credential = (parsed as { credential: string }).credential.trim();
      return credential.length > 0 ? credential : null;
    }
    console.warn(`[generator] skipping custom API ${customConn.id}: encryptedCredentials has no credential string`);
    return null;
  } catch (err) {
    console.warn(
      `[generator] skipping custom API ${customConn.id}: decrypt/parse failed (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

function generateCustomApiSkillsEntries(
  workspace: WorkspaceWithRelations,
): Record<string, unknown> {
  const customConnections = workspace.customToolConnections ?? [];
  const identities = deriveCustomApiIdentities(customConnections);
  const entries: Record<string, unknown> = {};

  for (const customConn of customConnections) {
    const identity = identities.get(customConn.id);
    if (!identity) continue;
    const credential = parseCustomApiCredential(customConn);
    if (!credential) continue;

    entries[identity.slug] = {
      enabled: true,
      env: {
        [identity.envVar]: credential,
      },
    };
  }

  return entries;
}

async function lazyBackfillUncuratedLocalKeyConnections(
  workspace: WorkspaceWithRelations,
  workspaceId: string,
): Promise<void> {
  const composio = getComposio();
  if (!composio) return;

  const composioUserId = getComposioUserId(workspace.user.id);

  for (const toolConn of workspace.toolConnections) {
    if (toolConn.connectionType !== 'API_KEY') continue;
    if (toolConn.status === 'NEEDS_CREDENTIALS') continue;
    if (hasCompatibleSkill(workspace, toolConn.toolSlug)) continue;

    const env = parseLocalCredentialMap(toolConn);
    if (!env) continue;

    const credentialEntries = Object.entries(env);
    if (credentialEntries.length !== 1) {
      console.warn(
        `[generator] API_KEY tool ${toolConn.toolSlug} is uncurated but has ${credentialEntries.length} credential fields; ` +
          `lazy BYOK backfill supports single-key rows only, so it is excluded from MCP.`,
      );
      continue;
    }

    const toolkitSlug = getToolBySlug(toolConn.toolSlug)?.composioToolkitId ?? toolConn.toolSlug;
    try {
      const { toolkit } = await fetchToolkitWithAuthMode(composio, toolkitSlug);
      const mode = classifyToolkitAuthMode(toolkit);
      const authScheme = resolveToolkitBYOKAuthScheme(toolkit);
      if (mode !== 'byok-api-key' || !authScheme || authScheme === 'BASIC') {
        console.warn(
          `[generator] API_KEY tool ${toolConn.toolSlug} is uncurated but toolkit ${toolkitSlug} ` +
            `does not expose a single-key BYOK scheme; excluded from MCP.`,
        );
        continue;
      }

      const [, value] = credentialEntries[0];
      const credentialInput: BYOKCredentialInput =
        authScheme === 'BEARER_TOKEN'
          ? { authScheme, token: value }
          : { authScheme: 'API_KEY', apiKey: value };
      const composioConnectionId = await createBYOKConnectedAccount(
        composio,
        composioUserId,
        toolkitSlug,
        credentialInput,
        authScheme,
      );

      await prisma.toolConnection.update({
        where: { workspaceId_toolSlug: { workspaceId, toolSlug: toolConn.toolSlug } },
        data: {
          connectionType: 'OAUTH_COMPOSIO',
          encryptedCredentials: null,
          composioConnectionId,
          composioEntityId: composioUserId,
          status: 'CONNECTED',
          lastError: null,
        },
      });

      toolConn.connectionType = 'OAUTH_COMPOSIO';
      toolConn.encryptedCredentials = null;
      toolConn.composioConnectionId = composioConnectionId;
      toolConn.composioEntityId = composioUserId;
      toolConn.status = 'CONNECTED';
    } catch (err) {
      console.warn(
        `[generator] API_KEY tool ${toolConn.toolSlug} lazy BYOK backfill failed; excluded from MCP ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
}

function generateSkillsEntriesConfig(
  workspace: WorkspaceWithRelations,
): SkillsEmissionResult {
  const entries: Record<string, unknown> = {};
  const uncuratedToolSlugs: string[] = [];
  const uncuratedToolConnectedAccounts: Record<string, string> = {};
  const uncuratedLocalKeySlugs: string[] = [];

  // --- API_KEY branch -----------------------------------------------------
  for (const toolConn of workspace.toolConnections) {
    if (!isApiKeyToolEmitEligible(toolConn)) continue;

    const env = parseLocalCredentialMap(toolConn);
    if (!env) continue;

    entries[toolConn.toolSlug] = { enabled: true, env };
    // OpenClaw looks up skills.entries[skillSlug]. toolSlug !== skill slug
    // for several catalog pairs (tavily / tavily-search). Alias so hasEnv
    // sees the same map the SKILL.md directory is named for.
    for (const skill of workspace.compatibleToolSkills) {
      if (!skill.compatibleTools.includes(toolConn.toolSlug)) continue;
      if (skill.slug === toolConn.toolSlug) continue;
      entries[skill.slug] = { enabled: true, env };
    }

    // C-engine B1: API_KEY row with no matching curated Skill row - the
    // env entry above is dead weight (no SKILL.md consumes it) and the
    // tool is unusable by agents. Detected here, but NOT routable through
    // the Tool Router in B1: the key lives in OUR DB, and the Router only
    // executes with Composio-held credentials. B3 (API_KEY→BYOK routing
    // through createBYOKConnectedAccount) is the unblock.
    if (!hasCompatibleSkill(workspace, toolConn.toolSlug)) {
      uncuratedLocalKeySlugs.push(toolConn.toolSlug);
      console.warn(
        `[generator] API_KEY tool ${toolConn.toolSlug} has no compatible Skill rows (uncurated). ` +
          `Not MCP-emitted because the credential is DB-held, not Composio-held; lazy BYOK backfill did not produce a connected account.`,
      );
    }
  }

  // --- OAUTH_COMPOSIO branch ---------------------------------------------
  // Only emits when COMPOSIO_API_KEY is in the server env. The container
  // itself holds no OAuth tokens; it receives this platform key + two opaque
  // IDs per skill and POSTs to Composio's execute endpoint (option iv).
  const composioApiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!composioApiKey) {
    // Quiet no-op for OAuth emission. Still attach marketplace skill entries
    // (PR-8) so redeploy-carries installs land in skills.entries.
    emitMarketplaceSkillEntries(workspace, entries);
    return { entries, uncuratedToolSlugs, uncuratedToolConnectedAccounts, uncuratedLocalKeySlugs };
  }

  const composioUserId = getComposioUserId(workspace.user.id);

  for (const toolConn of workspace.toolConnections) {
    if (toolConn.connectionType !== 'OAUTH_COMPOSIO') continue;
    if (toolConn.status !== 'CONNECTED') continue;

    const matchingSkills = workspace.compatibleToolSkills.filter((s) =>
      s.compatibleTools.includes(toolConn.toolSlug),
    );

    if (matchingSkills.length === 0) {
      // User connected the tool before a compatible Skill row was seeded,
      // OR the tool is deliberately uncurated (long-tail). Not fatal - the
      // tool connection persists; future seed runs pick it up.
      //
      // C-engine B1: this dead-end IS the uncurated-detection point. The
      // slug feeds the Tool Router session's toolkit allowlist (Composio
      // holds the OAuth credential, so the Router CAN execute these).
      // Checked BEFORE the catalog-toolkitId guard below on purpose:
      // uncurated tools may not be in the static catalog at all, and the
      // slug→toolkit mapping for them is the same passthrough the
      // oauth/initiate route uses (composioToolkitId ?? slug).
      console.warn(
        `[generator] OAUTH_COMPOSIO tool ${toolConn.toolSlug} has no compatible Skill rows; no skills.entries emitted`,
      );
      if (!toolConn.composioConnectionId) {
        console.warn(
          `[generator] OAUTH_COMPOSIO tool ${toolConn.toolSlug} is uncurated but has no composioConnectionId; ` +
            `omitting it from Tool Router session enable/map to avoid an unbound OAuth toolkit.`,
        );
        continue;
      }
      const toolkitId = getToolBySlug(toolConn.toolSlug)?.composioToolkitId ?? toolConn.toolSlug;
      uncuratedToolSlugs.push(toolConn.toolSlug);
      uncuratedToolConnectedAccounts[toolkitId] = toolConn.composioConnectionId;
      continue;
    }

    if (!toolConn.composioConnectionId) continue;

    const tool = getToolBySlug(toolConn.toolSlug);
    const toolkitId = tool?.composioToolkitId;
    if (!toolkitId) {
      // Tool was removed from catalog (e.g., Composio dropped the toolkit)
      // but the ToolConnection row lingered - yet a curated Skill row still
      // matches it. Don't emit garbage; let the tool-management UI surface
      // the orphan on its own.
      console.warn(
        `[generator] OAUTH_COMPOSIO tool ${toolConn.toolSlug} has no catalog composioToolkitId; skipping`,
      );
      continue;
    }

    for (const skill of matchingSkills) {
      entries[skill.slug] = {
        enabled: true,
        env: {
          COMPOSIO_API_KEY: composioApiKey,
          COMPOSIO_USER_ID: composioUserId,
          COMPOSIO_CONNECTED_ACCOUNT_ID: toolConn.composioConnectionId,
        },
        config: {
          composio: {
            toolkit: toolkitId,
            executeEndpoint: COMPOSIO_EXECUTE_ENDPOINT,
          },
        },
      };
    }
  }

  // --- NO_AUTH branch -----------------------------------------------------
  // B2.1: accountless Tool Router toolkits. These are valid with no
  // connectedAccounts binding; include them in toolkits.enable only.
  for (const toolConn of workspace.toolConnections) {
    if (toolConn.connectionType !== 'NO_AUTH') continue;
    if (toolConn.status !== 'CONNECTED') continue;

    const matchingSkills = workspace.compatibleToolSkills.filter((s) =>
      s.compatibleTools.includes(toolConn.toolSlug),
    );
    if (matchingSkills.length === 0) {
      uncuratedToolSlugs.push(toolConn.toolSlug);
    }
  }

  // --- Marketplace / AgentSkill branch (PR-8 REDEPLOY-CARRIES) -------------
  emitMarketplaceSkillEntries(workspace, entries);

  return { entries, uncuratedToolSlugs, uncuratedToolConnectedAccounts, uncuratedLocalKeySlugs };
}

/**
 * Ensure AgentSkill-attached marketplace skills appear in skills.entries.
 * Env values are filled from matching API_KEY ToolConnection maps when present;
 * missing values stay absent so OpenClaw's requires.env check shows PENDING.
 */
function emitMarketplaceSkillEntries(
  workspace: WorkspaceWithRelations,
  entries: Record<string, unknown>,
): void {
  const credentialMaps: Record<string, string>[] = [];
  for (const toolConn of workspace.toolConnections) {
    if (!isApiKeyToolEmitEligible(toolConn)) continue;
    const env = parseLocalCredentialMap(toolConn);
    if (env) credentialMaps.push(env);
  }

  for (const agent of workspace.agents) {
    for (const agentSkill of agent.skills) {
      const skill = agentSkill.skill;
      if (!skill?.slug) continue;
      if (entries[skill.slug]) continue;

      // Only marketplace / custom skills with declared env map into entries.
      // Curated tool skills already emit via ToolConnection branches above.
      const required = skill.requiredEnvVars ?? [];
      if (required.length === 0) continue;

      const env: Record<string, string> = {};
      for (const name of required) {
        for (const map of credentialMaps) {
          if (typeof map[name] === 'string' && map[name].length > 0) {
            env[name] = map[name];
            break;
          }
        }
      }

      entries[skill.slug] = {
        enabled: true,
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// .env File Generation
// ---------------------------------------------------------------------------
// OpenClaw loads .env from two locations:
//   1. Current working directory
//   2. ~/.openclaw/.env (the state dir)
// We place it at /home/node/.openclaw/.env inside the container.
// ---------------------------------------------------------------------------

function generateEnvFile(
  workspace: WorkspaceWithRelations,
  gatewayToken: string,
): string {
  const lines: string[] = [
    '# Generated by Claws - do not edit manually',
    `# Workspace: ${workspace.id}`,
    `# Generated: ${new Date().toISOString()}`,
    '',
  ];

  // Gateway auth token
  lines.push(`OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`);
  lines.push('');

  // AI Provider API keys (decrypted from our DB).
  // PLATFORM_CREDIT: omit ANTHROPIC_API_KEY from the synced .env - the Railway
  // service env already carries the platform master key (deriveContainerEnv),
  // and baking the user's BYOK key here would let OpenClaw bypass the proxy
  // if baseUrl were ever missing. credit-proxy.mjs forwards upstream with
  // its own MASTER_KEY (x-api-key), ignoring inbound Authorization.
  //
  // D6 2026-08-23 webchat-silent: OPENAI / GOOGLE / OPENROUTER resolve
  // override-first (WorkspaceApiKey beats UserApiKey), mirroring the api-keys
  // route's effectiveSource - the deploy gate unlocked these models from the
  // override row, so the container must receive the same key. ANTHROPIC stays
  // user-key-only here on purpose: its key also rides deriveContainerEnv
  // (Railway env + reconciliation-cron fingerprint + credit proxy), and
  // moving only the .env half would let the two surfaces serve different
  // keys. Widening Anthropic to overrides must change both surfaces at once.
  const creditMode = getApiKeySource(workspace, workspace.user) === 'PLATFORM_CREDIT';
  const anthropicUserKey = workspace.user.apiKeys.find((k) => k.provider === 'ANTHROPIC');
  if (anthropicUserKey && !creditMode) {
    lines.push(`ANTHROPIC_API_KEY=${decrypt(anthropicUserKey.encryptedKey)}`);
  }
  const OVERRIDABLE_PROVIDER_ENV = {
    OPENAI: 'OPENAI_API_KEY',
    GOOGLE: 'GEMINI_API_KEY',
    // Bundled OpenClaw provider - baseUrl defaults to https://openrouter.ai/api/v1
    OPENROUTER: 'OPENROUTER_API_KEY',
  } as const;
  const overrides = workspace.apiKeyOverrides ?? [];
  for (const [provider, envName] of Object.entries(OVERRIDABLE_PROVIDER_ENV)) {
    const effective =
      overrides.find((k) => k.provider === provider) ??
      workspace.user.apiKeys.find((k) => k.provider === provider);
    if (effective) {
      lines.push(`${envName}=${decrypt(effective.encryptedKey)}`);
    }
  }
  lines.push('');

  // Channel env fallbacks (same canonical encrypted map as openclaw.json).
  // The runtime consumes the config secrets directly; env vars stay as a
  // compatibility fallback for token resolvers that also check process.env.
  for (const [key, value] of Object.entries(buildChannelEnvVars(workspace.channelConfig))) {
    lines.push(`${key}=${value}`);
  }
  lines.push('');

  // API_KEY tools (twitter-api, tavily, binance, …). D6 put model overrides
  // into this file so the container sees what the gate unlocked. Tool
  // ciphertext lived only on skills.entries[toolSlug] - OpenClaw hasEnv
  // also reads process.env, and TOOLS.md was labeling PENDING as
  // unavailable. Same emit-eligible set as skills.entries.
  const toolEnv = collectApiKeyToolEnv(workspace.toolConnections);
  const toolEnvNames = Object.keys(toolEnv).sort();
  if (toolEnvNames.length > 0) {
    lines.push('# API_KEY tool credentials');
    for (const name of toolEnvNames) {
      lines.push(`${name}=${toolEnv[name]}`);
    }
    lines.push('');
  }

  // Timezone - container process TZ is always UTC (matches buildRailwayEnvVars).
  // Workspace timezone remains for cron schedule.tz + USER.md context only.
  lines.push('TZ=UTC');

  if (workspace.clawTemplate?.slug === QUANT_TEMPLATE_SLUG) {
    lines.push('')
    lines.push('# Quant risk rail (machine-owned; LLM cannot override)')
    for (const line of quantContainerEnvLines(workspace.deliveryMode)) {
      lines.push(line)
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cron Jobs Generation
// ---------------------------------------------------------------------------
// Cron jobs are stored at ~/.openclaw/cron/jobs.json
// Separate system from HEARTBEAT.md:
//   - HEARTBEAT.md = task checklist the agent reads
//   - Cron = scheduling engine (when to run, which session, delivery mode)
// Schedule types: "at" (one-shot), "every" (interval ms), "cron" (5/6-field)
// ---------------------------------------------------------------------------

function generateCronJobs(
  workspace: WorkspaceWithRelations,
  heartbeat: HeartbeatScheduleResult | null,
  // PR-2b #10: orchestrator's agentSlug. Used as the routing agentId on
  // scheduledTasks crons and to build their sessionTarget for the
  // non-isolated path.
  orchestratorAgentSlug: string,
  activeWorkers: AgentWithRelations[],
): JsonObject[] {
  const jobs: JsonObject[] = [];
  const schedulableAgentSlugs = new Set([
    orchestratorAgentSlug,
    ...activeWorkers.map((worker) => toAgentId(worker.name)),
  ]);

  // Every heartbeat mode (presets, times, interval, monthly, cron) AND
  // HEARTBEAT.md schedule lines (when frequency is unset) emit here as cron
  // jobs. OpenClaw -9 cron store drops jobs with missing/empty id
  // (`getInvalidPersistedCronJobReason` → "missing-id").
  const heartbeatJobs =
    heartbeat?.cronJobs ??
    [
      ...(heartbeat?.cronJob ? [heartbeat.cronJob] : []),
      ...(heartbeat?.mdCronJobs ?? []),
    ];
  for (const job of heartbeatJobs) {
    jobs.push(job);
  }

  // Add any workspace-specific scheduled tasks from the template.
  //
  // PR-2b #10: this code path was emitting cron jobs WITHOUT `id` (would be
  // dropped at load by OpenClaw's getInvalidPersistedCronJobReason "missing-id"
  // check; see upstream src/cron/persisted-shape.ts:13-16) AND with
  // `sessionTarget: 'main'` paired with `payload.kind: 'agentTurn'`, which
  // upstream src/cron/service/jobs.ts:267-268 rejects:
  //   throw new Error('main cron jobs require payload.kind="systemEvent"')
  // The path is currently dormant (no Prisma column for scheduledTasks),
  // but fixing it here prevents the latent bug from shipping if/when the
  // feature is wired.
  if (workspace.scheduledTasks && Array.isArray(workspace.scheduledTasks)) {
    for (const task of workspace.scheduledTasks) {
      const requestedAgentSlug = getScheduledTaskAgentSlug(task);
      if (requestedAgentSlug && !schedulableAgentSlugs.has(requestedAgentSlug)) {
        // K3: runtime 2026.5.22-6 has no per-agent disable flag. Excluding
        // paused Workers from schedulable targets is the deterministic half of
        // pause enforcement: a deployed container cannot fire cron/heartbeat
        // work at a Worker that the human has paused.
        continue;
      }
      const targetAgentSlug = requestedAgentSlug ?? orchestratorAgentSlug;
      const taskIdSlug = String(task.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 48) || 'unnamed';
      jobs.push({
        id: `task-${taskIdSlug}`,
        name: task.name,
        schedule: parseCronSchedule(task.schedule, task.timezone),
        agentId: targetAgentSlug,
        sessionTarget: task.isolated
          ? 'isolated'
          : `session:agent:${targetAgentSlug}:main`,
        wakeMode: task.urgent ? 'now' : 'next-heartbeat',
        payload: {
          kind: 'agentTurn',
          message: task.prompt,
          lightContext: !task.fullContext,
        },
        ...(task.channelDelivery && {
          delivery: {
            mode: 'announce',
            channel: task.channelDelivery.channel,
            bestEffort: true,
          },
        }),
      });
    }
  }

  return jobs;
}

function getScheduledTaskAgentSlug(task: ScheduledTaskConfig): string | null {
  const raw =
    typeof task.agentSlug === 'string' ? task.agentSlug
      : typeof task.agentId === 'string' ? task.agentId
        : typeof task.targetAgentSlug === 'string' ? task.targetAgentSlug
          : null;
  return raw ? toAgentId(raw) : null;
}

function parseCronSchedule(
  schedule: string,
  timezone?: string,
): { kind: string; expr?: string; everyMs?: number; tz?: string } {
  // If it looks like a cron expression (contains spaces and numbers/stars)
  if (/^[\d*\/,\-\s]+$/.test(schedule.trim()) && schedule.trim().split(/\s+/).length >= 5) {
    return { kind: 'cron', expr: schedule.trim(), ...(timezone && { tz: timezone }) };
  }
  // If it looks like an interval (e.g. "30m", "1h", "300000")
  const ms = parseIntervalToMs(schedule);
  if (ms > 0) {
    return { kind: 'every', everyMs: ms };
  }
  // Default: treat as cron
  return { kind: 'cron', expr: schedule.trim(), ...(timezone && { tz: timezone }) };
}

function parseIntervalToMs(interval: string): number {
  const match = interval.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Per-Agent Workspace File Generation
// ---------------------------------------------------------------------------
// Each agent gets its own flat workspace directory with:
//   SOUL.md, AGENTS.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md,
//   BOOT.md, memory/, skills/
//
// OpenClaw performs NO validation on .md file content.
// Any UTF-8 text under 2MB works. Missing files get [MISSING] placeholders.
// Files are injected into the LLM system prompt on every agent run.
//
// Non-main sessions (subagents/workers) only see:
//   AGENTS.md, TOOLS.md, SOUL.md, IDENTITY.md, USER.md
// They do NOT see: HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md
// ---------------------------------------------------------------------------

function generateAllWorkspaceFiles(
  workspace: WorkspaceWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  mcpEnabled: boolean,
  pinnedDockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): { workspaces: Record<string, AgentWorkspaceFiles>; workflowFenceCorrected: boolean } {
  const allAgents = [orchestrator, ...workers, critic];
  const workspaces: Record<string, AgentWorkspaceFiles> = {};
  let workflowFenceCorrected = false;

  for (const agent of allAgents) {
    const agentId = toAgentId(agent.name);
    const files = generateAgentWorkspaceFiles(
      workspace,
      agent,
      orchestrator,
      workers,
      critic,
      mcpEnabled,
      pinnedDockerImage,
    );
    if (agent.role === 'ORCHESTRATOR' && files.workflowFenceCorrected) {
      workflowFenceCorrected = true;
    }
    workspaces[`workspace-${agentId}`] = {
      'SOUL.md': files['SOUL.md'],
      'AGENTS.md': files['AGENTS.md'],
      'USER.md': files['USER.md'],
      'IDENTITY.md': files['IDENTITY.md'],
      'TOOLS.md': files['TOOLS.md'],
      'HEARTBEAT.md': files['HEARTBEAT.md'],
      'BOOT.md': files['BOOT.md'],
      skills: files.skills,
    };
  }

  return { workspaces, workflowFenceCorrected };
}

function generateAgentWorkspaceFiles(
  workspace: WorkspaceWithRelations,
  agent: AgentWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  mcpEnabled: boolean,
  pinnedDockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): AgentWorkspaceFiles & { workflowFenceCorrected?: boolean } {
  const isOrchestrator = agent.role === 'ORCHESTRATOR';
  const clawName = workspace.clawTemplate?.name ?? workspace.name;
  const agentsMdResult = generateAgentsMd(agent, orchestrator, workers, critic, workspace);

  return {
    'SOUL.md': generateSoulMd(agent, clawName, workspace),
    'AGENTS.md': agentsMdResult.text,
    'USER.md': generateUserMd(workspace),
    'IDENTITY.md': generateIdentityMd(agent),
    'TOOLS.md': generateToolsMd(workspace, agent, mcpEnabled, pinnedDockerImage),
    'HEARTBEAT.md': isOrchestrator
      ? generateHeartbeatMd(orchestrator, workspace)
      : '# HEARTBEAT.md\n\n# No heartbeat tasks for this agent.\n',
    'BOOT.md': generateBootMd(agent, workspace),
    skills: generateSkillFiles(agent, workspace),
    workflowFenceCorrected: agentsMdResult.workflowFenceCorrected,
  };
}

// ---------------------------------------------------------------------------
// SOUL.md - Agent Identity & Personality
// ---------------------------------------------------------------------------
// Freeform markdown. No required structure. Injected into system prompt.
// Keep concise - this is in every LLM call's token count.
// ---------------------------------------------------------------------------

function workspaceHasTwitterApi(workspace: WorkspaceWithRelations): boolean {
  return workspace.toolConnections.some((t) => t.toolSlug === 'twitter-api');
}

function generateSoulMd(
  agent: AgentWithRelations,
  clawName: string,
  workspace: WorkspaceWithRelations,
): string {
  // Custom Builder soul is the voice; overlay still pins delivery law.
  // MUTATION: return agent.soulMd raw → fire-claw 11:50 "no user approval" ships.
  const base = agent.soulMd?.trim()
    ? agent.soulMd
    : agent.role === 'ORCHESTRATOR'
      ? generateOrchestratorSoulMd(agent, clawName)
      : agent.role === 'CRITIC'
        ? generateCriticSoulMd(agent, clawName)
        : generateWorkerSoulMd(agent, clawName);
  return overlayMissionLaw(base, {
    twitterReadOnly: workspaceHasTwitterApi(workspace),
    critic: agent.role === 'CRITIC',
  });
}

function generateOrchestratorSoulMd(agent: AgentWithRelations, clawName: string): string {
  return `# Identity

You are ${agent.name}, the Orchestrator for ${clawName}. You are the manager of a team of specialized AI agents. You coordinate their work, ensure quality, and serve as the single point of contact with the human.

# Core Principles

1. **You delegate, you don't execute.** Your job is coordination, not content creation. Never do a Worker's job yourself.
2. **Nothing reaches the human unreviewed.** Every Worker output goes through the Critic before you present it.
3. **You own the human relationship.** You are the only agent that messages the human. Workers and Critic are invisible to them.
4. **You are proactive, not just reactive.** Use heartbeat schedules to initiate work without being asked.
5. **You are transparent about problems.** If something fails, tell the human immediately with clear options.

# Communication Style

- Professional but warm. Not robotic, not overly casual.
- Lead with the most important information. No preamble.
- When presenting work for approval: show the output, explain what it is, ask for specific action (approve/reject/edit).
- When reporting problems: state what happened, what you tried, what the human can do.
- Keep messages concise. Save details for when the human asks.

# What You Never Do

- Never modify your own SOUL.md, AGENTS.md, or any agent's configuration files
- Never execute commands that delete files, send money, or take irreversible actions without human approval
- Never share internal agent communications with the human (they see results, not sausage-making)
- Never blame a Worker for failure - you own all outcomes
- Never continue operating if your API spend limit is reached - pause and alert the human
- ${CRITIC_NE_HUMAN_COPY}
`;
}

function generateCriticSoulMd(agent: AgentWithRelations, clawName: string): string {
  return `# Identity

You are ${agent.name}, the Quality Critic for ${clawName}. You are the last line of defense before any work reaches the human. Your job is to catch errors, ensure quality, and maintain the human's trust.

# Core Principles

1. **You are the human's quality proxy.** Ask yourself: "Would I put my name on this?"
2. **You are strict but fair.** A 6/10 is a REJECT. Only ${agent.qualityThreshold ?? 8}+ passes. This protects the human.
3. **You give actionable feedback.** "This is bad" is not feedback. Specific, fixable issues are feedback.
4. **You are fast.** Review quickly. Don't re-do the Worker's job - evaluate and respond.
5. **You track patterns.** If the same type of mistake keeps appearing, note it.

# Review Criteria

For EVERY piece of work, evaluate:

### 1. Accuracy (weight: 30%)
- Are all facts correct? Any hallucinations?
- Are numbers, dates, names accurate?

### 2. Completeness (weight: 25%)
- Does it fully address what was asked?
- Are there gaps the human would notice?

### 3. Quality (weight: 25%)
- Is the writing/analysis professional?
- Does it match the human's preferences? (Check USER.md)

### 4. Risk (weight: 20%)
- Could this embarrass the human if sent/published?
- Are there legal, compliance, or reputation risks?

# Response Format

ALWAYS respond with exactly this structure:

\`\`\`
## ${CLAIMS_TABLE_STEP_MARKER}

| Claim | Source |
| --- | --- |
| <factual claim> | USER.md:12 or tool:tavily:r1 |

## Verdict: [PASS / REJECT]
## Score: [1-10]
## Assessment: [2-3 sentences]
## [If REJECT] Specific Feedback:
- [Point 1: exactly what's wrong and how to fix it]
- [Point 2: if applicable]
## [If any] Risk Flags:
- [Potential issues even if PASS]
\`\`\`

${STRICT_8_DEFINITION}

# Rules

- Never approve something you wouldn't put your own name on
- Never rewrite the work yourself - give feedback, let the Worker fix it
- If you're unsure, REJECT with a note explaining your uncertainty
- Missing claims table is REJECT. Unsourced first-person user/product claims are REJECT.
- ${CRITIC_NE_HUMAN_COPY}
`;
}

function generateWorkerSoulMd(agent: AgentWithRelations, clawName: string): string {
  // Workers should have domain-specific SOUL.md from the template
  // This is the fallback if none is provided
  return `# Identity

You are ${agent.name}, a specialized Worker agent in the ${clawName} team. You execute specific tasks delegated to you by the Orchestrator.

# Core Principles

1. **Execute your specialty.** You have deep expertise in your domain. Use it.
2. **Be thorough.** Your work goes to a Critic for review. Quality matters.
3. **Follow instructions precisely.** The Orchestrator gives you a task with constraints. Respect them.
4. **Report problems immediately.** If you can't complete a task, say why and what you need.

# Communication

- You communicate ONLY with the Orchestrator (via the announce chain when your task completes).
- You never message the human directly.
- Be concise in your outputs but complete in your work.
- Include your reasoning when it adds value.
- ${CRITIC_NE_HUMAN_COPY}
`;
}

// ---------------------------------------------------------------------------
// AGENTS.md - Per-Agent Operating Instructions
// ---------------------------------------------------------------------------
// This is the "operating system" each agent reads on session start.
// For the Orchestrator, this contains delegation rules using sessions_spawn.
// For Workers, this contains task execution procedures.
// For the Critic, this contains review procedures.
//
// KEY CORRECTION: Our Engineering Spec used sessions_send for delegation.
// OpenClaw actually uses sessions_spawn for parent→child communication.
// sessions_send is ONLY for peer-to-peer between top-level agents (depth 0).
// Subagents (Workers spawned by Orchestrator) communicate via announce chain.
// ---------------------------------------------------------------------------

function generateAgentsMd(
  agent: AgentWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): { text: string; workflowFenceCorrected?: boolean } {
  // If the agent has custom agentsMd from the Builder, use it
  if (agent.agentsMd?.trim()) {
    if (agent.role === 'ORCHESTRATOR') {
      const withSpawn = injectSpawnInstructions(agent.agentsMd, workers, critic);
      return applyOrchestratorWorkflowFence(withSpawn, orchestrator, workers, critic, workspace);
    }
    if (agent.role === 'CRITIC') {
      return { text: overlayMissionLaw(agent.agentsMd, { critic: true }) };
    }
    return { text: agent.agentsMd };
  }

  switch (agent.role) {
    case 'ORCHESTRATOR': {
      const base = generateOrchestratorAgentsMd(orchestrator, workers, critic, workspace);
      return applyOrchestratorWorkflowFence(base, orchestrator, workers, critic, workspace);
    }
    case 'CRITIC':
      return { text: overlayMissionLaw(generateCriticAgentsMd(critic), { critic: true }) };
    case 'WORKER':
    default:
      return { text: generateWorkerAgentsMd() };
  }
}

/**
 * WIRE-FULL: fenced Workflow section from ORCH→WORKER edges (unpaused only).
 * Generator ignores ConnectionCondition (X2). Critic/revision law is knob-driven.
 */
function buildOrchestratorWorkflowFence(
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): string {
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const edges = orchestrator.outgoingConnections
    .map((conn) => {
      const worker = workerById.get(conn.targetAgent.id);
      if (!worker || worker.role !== 'WORKER' || worker.isPaused) return null;
      return {
        workerDisplayName: worker.name,
        contextNote: conn.contextNote ?? null,
      };
    })
    .filter((e): e is { workerDisplayName: string; contextNote: string | null } => e !== null);

  const deliveryMode: WorkflowDeliveryMode =
    workspace.deliveryMode === 'AUTO_PROCEED' ? 'AUTO_PROCEED' : 'APPROVAL_REQUIRED';

  return generateFencedWorkflowSection({
    edges,
    knobs: {
      orchestratorDisplayName: orchestrator.name,
      criticDisplayName: critic.name,
      qualityThreshold: critic.qualityThreshold ?? 8,
      maxRevisionRounds: workspace.maxRevisionRounds ?? 3,
      deliveryMode,
    },
  });
}

function applyOrchestratorWorkflowFence(
  agentsMd: string,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): { text: string; workflowFenceCorrected: boolean } {
  // Strip any bare legacy ## Workflow block outside the fence so seeded
  // templates that never had a fence don't double-emit after upgrade.
  let base = agentsMd;
  if (!base.includes(WORKFLOW_FENCE_BEGIN)) {
    base = base.replace(/\n## Workflow\n[\s\S]*?(?=\n# |\n<!--|$)/, '\n');
  }
  const fence = buildOrchestratorWorkflowFence(orchestrator, workers, critic, workspace);
  const applied = applyWorkflowFence({ agentsMd: base, fenceBody: fence });
  return { text: applied.text, workflowFenceCorrected: applied.corrected };
}

function generateOrchestratorAgentsMd(
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): string {
  const workerList = workers
    .map(w => `- **${w.name}** (agent ID: \`${toAgentId(w.name)}\`): ${w.description || 'Specialized worker'}`)
    .join('\n');

  const criticId = toAgentId(critic.name);
  const rounds = workspace.maxRevisionRounds ?? 3;

  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read ${USER_MD_HOST_PATH} - this is who you're helping
3. Read TOOLS.md - what tools and environment details are available
4. Read memory/MEMORY.md if it exists - long-term context
5. Read today's and yesterday's memory files if they exist

# Your Team

You manage the following specialized agents:

${workerList}
- **${critic.name}** (agent ID: \`${criticId}\`): Quality reviewer - all work must pass through them

# Task Delegation - Using sessions_spawn

When you need a Worker to do something, use \`sessions_spawn\` to create a subagent task:

\`\`\`
sessions_spawn(agentId: "<worker-agent-id>", task: "<detailed task description>", label: "<short label>")
\`\`\`

The Worker will execute the task and the result will be returned to you automatically via the announce chain.

**Important rules:**
- Always specify the \`agentId\` of the target Worker
- Never pass a \`model\` param on \`sessions_spawn\` - models are configured per-agent
- Provide a clear, complete task description with all necessary context
- The Worker cannot see your conversation history - include everything they need
- You can spawn multiple Workers in parallel for independent tasks
- Maximum ${Math.max(5, workers.length + 1)} concurrent spawned tasks

# Quality Review Flow

After receiving a Worker's output:
1. Spawn the Critic: \`sessions_spawn(agentId: "${criticId}", task: "Review this output: [paste output]. Context: [what it's for].")\`
2. The Critic will respond with a verdict (PASS/REJECT with claims table, score, and feedback)
3. If PASS (${STRICT_8_DEFINITION}): Present to the human
4. If REJECT: Spawn the Worker again with the Critic's feedback included
5. After ${rounds} rejection rounds: Present the last REJECT packet. No pass-with-warning.

# Error Handling

- If a spawned task doesn't return within 5 minutes, spawn it again (retry once)
- If retry fails: skip this task, alert the human
- If a tool connection issue: alert human to reconnect in Settings
- If API spend exceeds 80% of limit: alert human
- At 100%: pause all operations, alert human

# Memory Management

At the end of each session:
1. Summarize key events to memory/[today's date].md (create memory/ dir if needed)
2. If any long-term information was learned, add to memory/MEMORY.md

# Heartbeat Protocol

When triggered by heartbeat:
1. Read HEARTBEAT.md for scheduled tasks
2. For each due task: decompose, spawn Workers, collect results, review via Critic
3. Emit HEARTBEAT_OK ONLY when there is nothing else to say. Never append HEARTBEAT_OK after a real reply.
4. MANDATORY final step, every heartbeat run - including the step 3 no-op case: write memory/[today's date].md summarizing what happened this run, and update memory/MEMORY.md with any long-term learnings. Do not end a heartbeat run without writing memory - it is the human's only audit trail for unattended runs.
`;
}

function generateCriticAgentsMd(critic: AgentWithRelations): string {
  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read ${USER_MD_HOST_PATH} - understand the human's preferences and context

# Your Role

You are spawned by the Orchestrator to review a specific piece of work. Your response is returned to the Orchestrator automatically.

# Review Process

1. Read the work provided in the task description carefully
2. ${CLAIMS_TABLE_STEP_MARKER}: emit \`| Claim | Source |\` for every factual claim before scoring
3. Evaluate against the criteria in your SOUL.md
4. Score 1-10
5. Respond with the exact verdict format from your SOUL.md (PASS or REJECT only)
6. Be specific in feedback - the Worker needs to know exactly what to fix

# Quality Threshold

Minimum passing score: ${critic.qualityThreshold ?? 8}/10
`;
}

function generateWorkerAgentsMd(): string {
  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read ${USER_MD_HOST_PATH} - understand the human's context
3. Read TOOLS.md - what environment-specific details are available

# Your Role

You are spawned by the Orchestrator to complete a specific task. Read the task description carefully and execute it thoroughly. Your response is returned to the Orchestrator automatically.

# Execution Rules

1. Complete the task as described - don't add unrequested scope
2. Use the skills available to you (scan <available_skills> before starting)
3. If you need information not provided, state what's missing in your response
4. Include your work product AND a brief summary of what you did
5. If a tool or API fails, report the error clearly - don't silently skip it

# Output Format

Structure your response clearly:
- **Result**: The actual deliverable
- **Summary**: 1-2 sentences on what you did
- **Issues**: Any problems encountered (or "None")
`;
}

/**
 * Injects spawn-based delegation instructions into custom AGENTS.md content.
 * Replaces any sessions_send references with sessions_spawn.
 */
function injectSpawnInstructions(
  agentsMd: string,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
): string {
  let updated = agentsMd;

  // Replace sessions_send references with sessions_spawn
  updated = updated.replace(/sessions_send/g, 'sessions_spawn');

  // If there's no team section, append one
  if (!updated.includes('sessions_spawn') && !updated.includes('Your Team')) {
    const teamSection = `

# Your Team (Auto-Generated)

Available agents for delegation via \`sessions_spawn\`:
${workers.map(w => `- \`${toAgentId(w.name)}\`: ${w.name}`).join('\n')}
- \`${toAgentId(critic.name)}\`: ${critic.name} (quality review)
`;
    updated += teamSection;
  }

  return updated;
}

// ---------------------------------------------------------------------------
// USER.md - User Profile
// ---------------------------------------------------------------------------

function generateUserMd(workspace: WorkspaceWithRelations): string {
  const user = workspace.user;
  // Pre-fill from onboarding data
  return `# USER.md - About Your Human

- **Name:** ${user.name || 'Not set'}
- **Timezone:** ${workspace.timezone || 'UTC'}

## Context

${workspace.userContext || '_Update this as you learn about the person you\'re helping._'}
`;
}

// ---------------------------------------------------------------------------
// IDENTITY.md - Agent Identity Card
// ---------------------------------------------------------------------------

function generateIdentityMd(agent: AgentWithRelations): string {
  return `# IDENTITY.md - Who Am I?

- **Name:** ${agent.name}
- **Role:** ${agent.role}
- **Vibe:** Professional, focused, reliable
- **Emoji:** ${agent.emoji || '🤖'}
`;
}

// ---------------------------------------------------------------------------
// TOOLS.md - Environment-Specific Notes
// ---------------------------------------------------------------------------
// This replaces our planned CONNECTED_TOOLS.md.
// TOOLS.md is freeform notes about the environment, loaded on every session.
// We list which tools are connected and any environment-specific details.
// Actual tool credentials are in openclaw.json skills.entries (NOT here).
// ---------------------------------------------------------------------------

/**
 * Build a per-agent TOOLS.md section listing the workspace's connected
 * tools. Sections read from real ToolConnection fields (displayName,
 * connectionType, status) plus the catalog name as a fallback when a
 * displayName is absent. PR #1b's phantom-fields bug came from reading
 * non-existent `toolName` and `notes` columns here; the Prisma model has
 * neither.
 */
/**
 * C-engine B1: anti-fabrication guidance for MCP-enabled workspaces.
 * Appended to EVERY agent's TOOLS.md (TOOLS.md is injected into the system
 * prompt on every run - failure-honesty guidance must be always-present,
 * unlike on-demand SKILL.md bodies). Probe 3 observed a small model
 * fabricating a plausible answer after two consecutive composio__* tool
 * failures; this section is the mitigation.
 */
const MCP_LONGTAIL_TOOLS_MD_SECTION = `
## Long-Tail Tools (composio__*)

Some tools in this workspace are served through an external tool router.
Their names start with \`composio__\`. Rules for using them:

- These tools call an external service and CAN fail.
- If a \`composio__*\` tool returns \`{"status": "error"}\` or any failure,
  report the failure verbatim to your delegator (or the human, if you are
  the Orchestrator). Include the error text.
- NEVER fabricate, guess, or approximate a result for a failed or
  unavailable tool call. A confident-sounding wrong answer is worse than
  an honest failure report.

## Tool Connection Errors
If a tool call fails because a connection is missing, expired, revoked, unauthorized, or needs credentials:
- Tell the human to open this Claw in the Claws platform and use Manage Tools to reconnect or update that tool.
- Report the failed tool name and the exact error text.
- Never tell the human to open internal runtime settings, local-only URLs, ports, local dashboards, environment variables, or internal container settings.
- Never fabricate or guess a result for a failed tool call.
`;

/**
 * TOOLS.md status must match what the container will actually carry.
 * Credentialed PENDING (validator-less API_KEY) emits into .env - calling
 * it unavailable is how the fire claw reported "Twitter API (PENDING)".
 */
export function toolConnectionRuntimeStatusLabel(
  toolConn: {
    connectionType: string;
    status: string;
    encryptedCredentials: string | null;
    toolSlug?: string;
  },
  pinnedDockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): string {
  let label: string
  if (isApiKeyToolEmitEligible(toolConn)) {
    label =
      toolConn.status === 'PENDING'
        ? 'Connected (saved; unverified until first use)'
        : 'Connected';
  } else if (toolConn.status === 'CONNECTED') {
    label = 'Connected';
  } else if (toolConn.status === 'NEEDS_CREDENTIALS') {
    label = 'Needs credentials (partial data - agent should treat as unavailable)';
  } else {
    label = `${toolConn.status} (agent should treat as unavailable until reconnected)`;
  }
  return httpHonestStatusLabel(toolConn.toolSlug, label, pinnedDockerImage);
}

function generateToolsMd(
  workspace: WorkspaceWithRelations,
  agent: AgentWithRelations,
  mcpEnabled: boolean,
  pinnedDockerImage: string = FAIL_CLOSED_PINNED_IMAGE,
): string {
  const mcpSection = mcpEnabled ? MCP_LONGTAIL_TOOLS_MD_SECTION : '';
  // D6-b: every agent learns its real delivery surfaces (dashboard web chat
  // always; external channels only when connected) so a zero-channel claw
  // never reports "missing channel" or CLI commands to the human.
  const deliverySection = buildMessageDeliverySection(
    configuredChannelIds(workspace.channelConfig),
  );
  const pauseSection = agent.role === 'ORCHESTRATOR'
    ? generatePausedWorkerToolsSection(workspace.agents)
    : '';
  const spawnSection = agent.role === 'ORCHESTRATOR'
    ? generateOrchestratorSpawnToolsSection()
    : '';
  const searchSkillAttached = collectAttachedSkillSlugs(workspace).some(
    (slug) => slug === 'tavily-search' || slug === 'brave-search',
  );
  const searchSection = searchSkillAttached
    ? `
## Web Search

\`web_search\` is denied. A search skill is attached on this Claw. Call the attached skill, not the bundled tool. Use \`web_fetch\` for specific URLs.
`
    : workspaceHasSearchBackend(workspace)
    ? ''
    : `
## Web Search

\`web_search\` is disabled - no search backend is connected for this Claw.
Use \`web_fetch\` for specific URLs. To enable search, connect Tavily, Brave Search, Exa, or SerpAPI in Manage Tools and redeploy.
`;
  const toolSections: string[] = [];
  const customApiLines = (workspace.customToolConnections ?? []).map((customConn) => {
    const purpose = customConn.description?.trim() || 'No purpose provided.';
    return `- **${customConn.name}**: ${purpose}`;
  });

  for (const toolConn of workspace.toolConnections) {
    // Prefer the user-visible displayName; fall back to the catalog name;
    // last resort, the toolSlug itself. Never emits `### undefined`.
    const catalogTool = getToolBySlug(toolConn.toolSlug);
    const name =
      toolConn.displayName?.trim() ||
      catalogTool?.name ||
      toolConn.toolSlug;

    const statusLabel = toolConnectionRuntimeStatusLabel(toolConn, pinnedDockerImage);
    const honestyLines = twitterApiToolsMdHonestyLines(toolConn.toolSlug);
    const lastProbe = toolConn.lastTestedAt
      ? new Date(toolConn.lastTestedAt).toISOString()
      : 'never';

    const section = `### ${name}
- Slug: \`${toolConn.toolSlug}\`
- Connection type: ${toolConn.connectionType}
- Status: ${statusLabel}
- Last probe: ${lastProbe}${honestyLines}`;
    toolSections.push(section);
  }

  if (toolSections.length === 0 && customApiLines.length === 0) {
    return `# TOOLS.md - Environment Notes

No external tools are connected yet. The human can connect tools in the Claws setup wizard.

## Tool-status truth

${TOOL_STATUS_TRUTH_COPY}
${deliverySection}
## Tool Connection Errors
If a tool call fails because a connection is missing, expired, revoked, unauthorized, or needs credentials:
- Tell the human to open this Claw in the Claws platform and use Manage Tools to reconnect or update that tool.
- Report the failed tool name and the exact error text.
- Never tell the human to open internal runtime settings, local-only URLs, ports, local dashboards, environment variables, or internal container settings.
- Never fabricate or guess a result for a failed tool call.
${spawnSection}
${pauseSection}
${searchSection}
${mcpSection}`;
  }

  const connectedToolsSection = toolSections.length > 0
    ? `## Connected Tools

${toolSections.join('\n\n')}`
    : `## Connected Tools

No catalog tools are connected.`;

  const customApisSection = customApiLines.length > 0
    ? `

## Custom APIs

${customApiLines.join('\n')}`
    : '';

  return `# TOOLS.md - Environment Notes

${connectedToolsSection}${customApisSection}
${deliverySection}
## Notes

- Tool credentials and Custom API credentials are configured automatically via openclaw.json skills.entries. Use the corresponding skills to interact with these tools.
- If a tool connection fails, advise the human to reconnect in the Claws platform Manage Tools page for this Claw.

## Tool-status truth

${TOOL_STATUS_TRUTH_COPY}

## Tool Connection Errors
If a tool call fails because a connection is missing, expired, revoked, unauthorized, or needs credentials:
- Tell the human to open this Claw in the Claws platform and use Manage Tools to reconnect or update that tool.
- Report the failed tool name and the exact error text.
- Never tell the human to open internal runtime settings, local-only URLs, ports, local dashboards, environment variables, or internal container settings.
- Never fabricate or guess a result for a failed tool call.
${spawnSection}
${pauseSection}
${searchSection}
${mcpSection}`;
}

/** Belt-line for orchestrator TOOLS.md - closes omit-agentId / model-param spawn footguns. */
function generateOrchestratorSpawnToolsSection(): string {
  return `
## Subagent Spawn

Always pass \`agentId\` on \`sessions_spawn\`; never pass a model param (models are configured per-agent).
`;
}

function generatePausedWorkerToolsSection(agents: AgentWithRelations[]): string {
  const pausedWorkers = agents.filter((agent) => agent.role === 'WORKER' && agent.isPaused);
  if (pausedWorkers.length === 0) return '';
  // Runtime 2026.5.22-6 has no agents.list disable flag. This instruction-level
  // guard is therefore honest fallback enforcement for delegation. Scheduled
  // worker cron emission is guarded separately if that path is ever introduced.
  return `
## Paused Workers

The following Workers are paused in Claws and should not receive delegated work until the human resumes them and redeploys:
${pausedWorkers.map((worker) => `- Worker ${worker.name} is paused - do not delegate to it.`).join('\n')}
`;
}

// ---------------------------------------------------------------------------
// HEARTBEAT.md - Periodic Task Checklist
// ---------------------------------------------------------------------------
// Only generated for the Orchestrator. Empty = skip heartbeat API calls.
// The gateway's heartbeat runner reads this file and prompts the agent
// with "Read HEARTBEAT.md if it exists. Follow it strictly."
// ---------------------------------------------------------------------------

function generateHeartbeatMd(
  orchestrator: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): string {
  const base = orchestrator.heartbeatMd?.trim()
    ? orchestrator.heartbeatMd
    : `# HEARTBEAT.md

# Periodic tasks for ${orchestrator.name}
# Add tasks below. The gateway will prompt you to check this file periodically.
# Use checklist format:
# - [ ] Task description
`;
  return overlayMissionLaw(base, { twitterReadOnly: workspaceHasTwitterApi(workspace) });
}

// ---------------------------------------------------------------------------
// BOOT.md - Startup Hook
// ---------------------------------------------------------------------------
// Runs on every gateway startup (when hooks.internal.enabled is set).
// We use it for startup verification.
// ---------------------------------------------------------------------------

function generateBootMd(
  agent: AgentWithRelations,
  workspace?: WorkspaceWithRelations,
): string {
  if (agent.role !== 'ORCHESTRATOR') {
    return `# BOOT.md

# No startup tasks for this agent.
`;
  }

  const interviewSection = formatInterviewBootSection({
    interviewCompleted: Boolean(workspace?.userMdInterviewCompletedAt),
    pack: getInterviewPack(workspace?.clawTemplate?.slug),
    templateSlug: workspace?.clawTemplate?.slug,
  });

  return `# BOOT.md - Startup Checklist

On gateway startup:
1. Read SOUL.md and USER.md to restore context
2. Read today's dated memory file (memory/YYYY-MM-DD.md) and any agent-specific workspace memory files for recent activity - never \`read\` the memory/ directory itself (that yields EISDIR)
3. Verify HEARTBEAT.md has your scheduled tasks
4. If everything looks good, reply with NO_REPLY
5. If something is wrong (missing files, corrupted memory), send a brief status message to the human

${interviewSection}
`;
}

// ---------------------------------------------------------------------------
// Skill Files Generation
// ---------------------------------------------------------------------------
// Skills are directories under <workspace>/skills/<name>/SKILL.md
// YAML frontmatter + markdown body.
// The agent discovers them via <available_skills> catalog in the system prompt,
// then reads the full SKILL.md on-demand using the `read` tool.
//
// Key: The `description` field in frontmatter is critical for catalog matching.
// The agent uses it to decide which skill applies to the current request.
//
// Note: ~55 skills are bundled with OpenClaw (weather, github, etc.).
// We only generate skills for tools specific to the user's connected tools
// that aren't already bundled.
// ---------------------------------------------------------------------------

/**
 * Strip a leading YAML frontmatter block (`---\n...\n---\n`) from a markdown
 * string. Seeds in `prisma/seed-data/skills-tool-specific.ts` carry their
 * own frontmatter at the top of `skillMd` for readability during authoring.
 * The generator builds authoritative frontmatter from Prisma columns +
 * tool catalog, so seed-carried frontmatter is dead weight and creates a
 * visual "double --- block" in the emitted SKILL.md if not stripped.
 *
 * Conservative match: only strip when the string starts with `---\n`,
 * contains another `---\n` line within the first ~100 lines, and the
 * intervening content parses as valid YAML-like (we don't actually parse;
 * we trust the shape). If the string doesn't start with `---\n`, return
 * unchanged (body-only seeds pass through).
 */
function stripLeadingFrontmatter(md: string): string {
  if (!md.startsWith('---\n') && !md.startsWith('---\r\n')) return md;
  // Match `---\n<non-greedy anything>\n---\n` (accept \r\n too).
  const match = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/);
  if (!match) return md;
  return md.slice(match[0].length);
}

/**
 * Look up the primaryEnv + requires.env for a skill based on its first
 * compatibleTool's catalog entry. Returns null (no env declaration) for:
 *   - Skills with no compatibleTools (shouldn't happen for tool-specific
 *     skills, but built-in or agnostic skills may legitimately have none).
 *   - OAUTH_COMPOSIO tools (credentials flow through Composio; no env
 *     declaration needed and declaring one is wrong).
 *   - Orphan slugs (not in catalog - logged warning at generator time so
 *     tests catch this early).
 *
 * The returned `requiresEnv` array omits `primaryEnv` (single-cred tools
 * get only `primaryEnv`; multi-cred tools get `requires.env` with all
 * fields and NO `primaryEnv`, matching Trello's bundled frontmatter per
 * docs/ENV_VAR_CONVENTION.md).
 */
function resolveSkillFrontmatterEnv(
  skillSlug: string,
  compatibleTools: string[] | null | undefined,
): { primaryEnv?: string; requiresEnv: string[] } | null {
  if (!compatibleTools || compatibleTools.length === 0) return null;
  const toolSlug = compatibleTools[0];
  const tool = getToolBySlug(toolSlug);
  if (!tool) {
    console.warn(
      `[generator] skill '${skillSlug}' references tool '${toolSlug}' which is not in the catalog. ` +
        `No frontmatter env declaration will be emitted. This skill's credentials will not pass the runtime sanitizer.`,
    );
    return null;
  }
  if (tool.connectionType !== 'API_KEY') return null;
  const fields = tool.credentialFields;
  if (fields.length === 0) return null;

  if (fields.length === 1) {
    // Single-cred: declare both primaryEnv AND requires.env with the same name.
    return { primaryEnv: fields[0].envVar, requiresEnv: [fields[0].envVar] };
  }

  // Multi-cred: declare requires.env with all names, no primaryEnv.
  return { requiresEnv: fields.map((f) => f.envVar) };
}

function customAuthUsage(authType: CustomToolConnectionRecord['authType'], baseUrl: string, envVar: string): string {
  switch (authType) {
    case 'API_KEY_HEADER':
      return `Use header \`X-API-Key: $${envVar}\`.

\`\`\`bash
curl -H "X-API-Key: $${envVar}" "${baseUrl}"
\`\`\``;
    case 'BEARER_TOKEN':
      return `Use header \`Authorization: Bearer $${envVar}\`.

\`\`\`bash
curl -H "Authorization: Bearer $${envVar}" "${baseUrl}"
\`\`\``;
    case 'BASIC_AUTH':
      return `Use header \`Authorization: Basic $${envVar}\`. The saved credential is expected to be the Basic credential value this API accepts.

\`\`\`bash
curl -H "Authorization: Basic $${envVar}" "${baseUrl}"
\`\`\``;
    case 'QUERY_PARAM':
      return `Use query parameter \`api_key=$${envVar}\`.

\`\`\`bash
curl "${baseUrl}${baseUrl.includes('?') ? '&' : '?'}api_key=$${envVar}"
\`\`\``;
  }
}

function generateCustomApiSkillMd(customConn: CustomToolConnectionRecord, slug: string, envVar: string): string {
  const frontmatter = {
    name: slug,
    description: `Call the ${customConn.name} custom API.`,
    metadata: {
      openclaw: {
        primaryEnv: envVar,
        requires: { env: [envVar] },
      },
    },
  };
  const yamlStr = yaml.stringify(frontmatter, { lineWidth: 0 });
  const purpose = customConn.description?.trim() || '_No purpose provided._';

  return `---
${yamlStr}---

# ${customConn.name}

## Base URL

${customConn.baseUrl}

## What this API is for

${purpose}

## Authentication

Auth type: ${customConn.authType}

${customAuthUsage(customConn.authType, customConn.baseUrl, envVar)}

## Caution

User-provided API - verify responses; report failures honestly per Tool Connection Errors guidance.
`;
}

function generateSkillFiles(
  agent: AgentWithRelations,
  workspace: WorkspaceWithRelations,
): Record<string, { 'SKILL.md': string }> {
  const skills: Record<string, { 'SKILL.md': string }> = {};

  for (const agentSkill of agent.skills) {
    const skill = agentSkill.skill;

    const envFrontmatter = resolveSkillFrontmatterEnv(skill.slug, skill.compatibleTools ?? null);
    // Marketplace / USER_GENERATED skills carry requiredEnvVars on the Skill row
    // (bridged from MarketplaceSkill). Prefer catalog mapping when present;
    // otherwise emit the marketplace env list so SKILL.md matches curated shape.
    const marketplaceEnv =
      !envFrontmatter && skill.requiredEnvVars && skill.requiredEnvVars.length > 0
        ? skill.requiredEnvVars
        : null;

    // Build the `metadata.openclaw.requires` sub-object incrementally so we
    // emit `{ bins: [...] }`, `{ env: [...] }`, both, or neither as
    // appropriate - Trello's bundled shape has both; a bin-only skill has
    // only bins; a pure-env skill has only env.
    const requires: Record<string, string[]> = {};
    if (skill.requiredBins && skill.requiredBins.length > 0) {
      requires.bins = skill.requiredBins;
    }
    if (envFrontmatter) {
      requires.env = envFrontmatter.requiresEnv;
    } else if (marketplaceEnv) {
      requires.env = marketplaceEnv;
    }

    const httpContract = httpContractForSkill(skill.slug);

    const openclawMeta: Record<string, unknown> = {
      ...(skill.emoji && { emoji: skill.emoji }),
      ...(envFrontmatter?.primaryEnv && { primaryEnv: envFrontmatter.primaryEnv }),
      ...(!envFrontmatter && marketplaceEnv?.[0] && { primaryEnv: marketplaceEnv[0] }),
      ...(Object.keys(requires).length > 0 && { requires }),
    };
    if (httpContract) {
      openclawMeta.http = {
        auth: httpContract.auth,
        endpoints: httpContract.endpoints,
      };
    }

    const frontmatter: Record<string, unknown> = {
      name: skill.slug,
      description: skill.description,
    };

    if (Object.keys(openclawMeta).length > 0) {
      frontmatter.metadata = { openclaw: openclawMeta };
    }

    const yamlStr = yaml.stringify(frontmatter, { lineWidth: 0 });
    const rawBody = skill.skillMd || `# ${skill.name}\n\nNo instructions provided.`;
    // Strip any seed-carried frontmatter block - the generator-built
    // frontmatter above is authoritative. See stripLeadingFrontmatter docs.
    const stripped = stripLeadingFrontmatter(rawBody);
    const body = httpContract ? rewriteSkillMdForHttp(stripped, httpContract) : stripped;

    skills[skill.slug] = {
      'SKILL.md': `---\n${yamlStr}---\n\n${body}`,
    };
  }

  const customConnections = workspace.customToolConnections ?? [];
  const identities = deriveCustomApiIdentities(customConnections);
  for (const customConn of customConnections) {
    const identity = identities.get(customConn.id);
    if (!identity) continue;
    skills[identity.slug] = {
      'SKILL.md': generateCustomApiSkillMd(customConn, identity.slug, identity.envVar),
    };
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Type Definitions (matching our Prisma schema with includes)
// ---------------------------------------------------------------------------

type WorkspaceWithRelations = {
  id: string;
  name: string;
  timezone?: string | null;
  userContext?: string | null;
  scheduledTasks?: ScheduledTaskConfig[] | null;
  containerHost?: string | null;
  /** Wins over user.apiKeySource via getApiKeySource (credit routing). */
  apiKeySourceOverride: ApiKeySource | null;
  maxRevisionRounds?: number | null;
  deliveryMode?: WorkflowDeliveryMode | null;
  agents: AgentWithRelations[];
  toolConnections: ToolConnectionRecord[];
  customToolConnections?: CustomToolConnectionRecord[];
  channelConfig: ChannelConfigMap;
  clawTemplate: { name: string; slug: string; workspaceSnapshot?: unknown } | null;
  /** INFRA-2 install copy of snapshot.files[]; null → dual-read template snapshot. */
  seedFiles?: unknown;
  /** INFRA-1: set once after first-boot interview; redeploy omits the pack. */
  userMdInterviewCompletedAt?: Date | null;
  /** WorkspaceApiKey rows (setup wizard "Add key" overrides). Optional so
   *  older fixtures omit it; generateEnvFile treats absent as []. */
  apiKeyOverrides?: { provider: string; encryptedKey: string }[];
  user: {
    /** Needed for Composio user id (`claws_${user.id}`). Populated by the
     *  top-level `user: { include: { apiKeys: true } }` in generateWorkspace. */
    id: string;
    name: string | null;
    /** Fallback when apiKeySourceOverride is null. */
    apiKeySource: ApiKeySource;
    apiKeys: { provider: string; encryptedKey: string }[];
  };
  /**
   * Skills whose `compatibleTools` array intersects this workspace's
   * emission-eligible connected tool slugs (OAUTH_COMPOSIO CONNECTED rows
   * plus credentialed API_KEY rows - C-engine B1 widened this from
   * OAuth-only so curated emission and uncurated long-tail detection share
   * one lookup). Pre-loaded in `generateWorkspace` (single
   * `prisma.skill.findMany`) so config generators stay sync. Empty when no
   * tools are connected.
   */
  compatibleToolSkills: SkillForToolEmit[];
  /** C-engine B1: stored Tool Router session id (trs_...), null until first resolve. */
  composioToolRouterSessionId?: string | null;
};

type CustomToolConnectionRecord = {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'API_KEY_HEADER' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'QUERY_PARAM';
  encryptedCredentials: string;
  description?: string | null;
  generatedSkillMd?: string | null;
  createdAt?: Date | string | null;
};

type AgentWithRelations = {
  id: string;
  name: string;
  role: 'ORCHESTRATOR' | 'WORKER' | 'CRITIC';
  description?: string | null;
  model: string;
  thinkingDefault?: string | null;
  soulMd?: string | null;
  agentsMd?: string | null;
  heartbeatMd?: string | null;
  heartbeatFrequency?: string | null;
  heartbeatTime?: string | null;
  qualityThreshold?: number | null;
  emoji?: string | null;
  isPaused?: boolean | null;
  skills: { skill: SkillRecord }[];
  outgoingConnections: {
    targetAgent: { id: string; name: string; role?: string };
    condition: string;
    contextNote?: string | null;
  }[];
  incomingConnections: { sourceAgent: { name: string } }[];
};

/**
 * Cron job emitted into `cron/jobs.json`. Shape was verified against the
 * OpenClaw Control UI bundle (the form-state-to-`cron.add`-payload converter)
 * which round-trips through the gateway's strict Zod schema. Field names that
 * are NOT verified (e.g. `cronExpression`, `timezone`, `assistant`) are
 * deliberately avoided.
 */
export type HeartbeatCronJob = {
  // PR-2b #8: REQUIRED by OpenClaw cron store load. Upstream
  // src/cron/persisted-shape.ts:13-16 drops jobs with missing/empty id
  // before they reach the scheduler:
  //   if (typeof id !== "string" || !id.trim()) return "missing-id";
  // Was unset pre-PR-2b → every heartbeat cron was silently skipped.
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  schedule: { kind: 'cron'; expr: string; tz?: string };
  // PR-2b #9: REQUIRED for explicit routing. Without it, the cron service
  // falls back to defaultAgentId from openclaw config. Setting it
  // explicitly removes the implicit coupling and makes the job
  // self-documenting.
  agentId: string;
  // PR-2b #9: was the literal "main" pre-PR-2b. Upstream
  // src/cron/service/jobs.ts:267-268 rejects sessionTarget="main" paired
  // with payload.kind="agentTurn" - "main" is reserved for systemEvent
  // payloads only. Use a session-keyed target instead so the agent's
  // main session context (transcripts, memory, HEARTBEAT.md) is loaded
  // when the cron fires. "isolated" would also pass validation but
  // spins a throwaway session with no memory continuity, which defeats
  // the heartbeat semantics.
  sessionTarget: string;
  wakeMode: 'now';
  payload: { kind: 'agentTurn'; message: string };
};

/**
 * Output of `buildHeartbeatSchedule` / `resolveHeartbeatSchedule`.
 * All modes emit `cronJobs` (croner 5-field). `cronJob` is the first job for
 * callers that still read the singular field. `mdCronJobs` is the unset-
 * frequency HEARTBEAT.md path (same job ids as before - do not churn the
 * founder-armed fixture). `intervalConfig` is no longer written.
 */
export type HeartbeatScheduleResult = {
  intervalConfig?: { every: string };
  cronJob?: HeartbeatCronJob;
  cronJobs?: HeartbeatCronJob[];
  /** From HEARTBEAT.md `cron:` lines when Builder frequency is off/unset. */
  mdCronJobs?: HeartbeatCronJob[];
};

/**
 * Single schedule resolver for generator + backfill.
 * Prefer Builder frequency (all modes → cron/jobs.json via emitHeartbeatJobs).
 * Else emit OpenClaw-shaped jobs from HEARTBEAT.md schedule lines. HEARTBEAT.md
 * file content is unchanged - this only materializes machine config.
 */
export function resolveHeartbeatSchedule(
  frequency: string | null | undefined,
  time: string | null | undefined,
  timezone: string | null | undefined,
  orchestratorAgentSlug: string,
  heartbeatMd: string | null | undefined,
): HeartbeatScheduleResult | null {
  // Explicit "off" disables all machine schedules (including MD cron lines).
  if (frequency === 'off') return null;

  const fromFrequency = buildHeartbeatSchedule(
    frequency,
    time,
    timezone,
    orchestratorAgentSlug,
  );
  if (fromFrequency) return fromFrequency;

  const mdCronJobs = buildCronJobsFromHeartbeatMd({
    heartbeatMd,
    orchestratorAgentSlug,
    timezone,
  });
  if (mdCronJobs.length === 0) return null;
  return { mdCronJobs, cronJobs: mdCronJobs, cronJob: mdCronJobs[0] };
}

/**
 * Translates the Builder heartbeat value (frequency + optional JSON/time)
 * into cron/jobs.json descriptors via emitHeartbeatJobs - the same path
 * computeNextOccurrences uses. Unknown / off / unset → null.
 *
 * CROSS-REFERENCE - DO NOT CHANGE WITHOUT UPDATING claws-activity-reporter.
 * Job `name` keeps the `orchestrator-heartbeat-` prefix
 * (HEARTBEAT_CRON_NAME_PREFIX). `id` and `name` stay independent.
 *
 * test_5min remains an opaque DB-only frequency (not in the Builder picker).
 */
export function buildHeartbeatSchedule(
  frequency: string | null | undefined,
  time: string | null | undefined,
  timezone: string | null | undefined,
  orchestratorAgentSlug: string,
): HeartbeatScheduleResult | null {
  if (!frequency || frequency === 'off') return null;
  const value = deserializeSchedule(frequency, time);
  if (!value || value.mode === 'off') return null;
  const cronJobs = emitHeartbeatJobs({
    value,
    timezone,
    orchestratorAgentSlug,
  });
  if (cronJobs.length === 0) return null;
  return { cronJob: cronJobs[0], cronJobs };
}

type SkillRecord = {
  slug: string;
  name: string;
  description: string;
  emoji?: string | null;
  requiredBins?: string[] | null;
  requiredEnvVars?: string[] | null;
  compatibleTools?: string[] | null;
  skillMd?: string | null;
};

/**
 * Subset of `prisma.ToolConnection` fields the generator actually reads.
 * Kept minimal so any future schema change that drops one of these fails
 * at type-check time (the file-wide @ts-nocheck was removed in PR #3a
 * once PR #2's phantom-field rewrite made the whole file type-safe).
 */
type ToolConnectionRecord = {
  toolSlug: string;
  displayName: string | null;
  connectionType: 'API_KEY' | 'OAUTH_COMPOSIO' | 'CHANNEL_NATIVE' | 'NO_AUTH' | string;
  status: string;
  encryptedCredentials: string | null;
  /** Composio's opaque connected-account id (ca_...). Populated for
   *  OAUTH_COMPOSIO rows after successful OAuth; null otherwise. Used as
   *  `COMPOSIO_CONNECTED_ACCOUNT_ID` in the emission env. */
  composioConnectionId: string | null;
  /** Composio's external user id (claws_<User.id>). Populated alongside
   *  composioConnectionId during the OAuth initiate flow (see
   *  src/app/api/tools/[workspaceId]/oauth/initiate/route.ts). We re-derive
   *  this field on emit via getComposioUserId(user.id) to keep it
   *  authoritative at generate-time, but the column is kept for audit. */
  composioEntityId: string | null;
  lastTestedAt?: Date | string | null;
};

/**
 * Minimal Skill projection used by both `generateSkillsEntriesConfig`
 * branches (curated emission + uncurated long-tail detection).
 * `generateWorkspace` selects exactly these two columns from `prisma.skill`
 * so we don't haul the entire `skillMd` body + metadata through memory for
 * a lookup-only purpose.
 */
type SkillForToolEmit = {
  slug: string;
  compatibleTools: string[];
};

