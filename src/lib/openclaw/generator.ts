// @ts-nocheck - Depends on channel infrastructure not yet in Prisma schema
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
import { decrypt } from '@/lib/encryption';
import { generateSecureToken } from '@/lib/crypto';
import yaml from 'yaml';

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
function toAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64);
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

export async function generateWorkspace(workspaceId: string): Promise<GeneratedWorkspace> {
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
      clawTemplate: true,
      user: {
        include: {
          apiKeys: true,
        },
      },
    },
  });

  // 2. Parse channel config from encrypted JSON blob
  let channelConnections: ChannelConnectionRecord[] = [];
  if (workspace.channelConfigEncrypted) {
    try {
      channelConnections = JSON.parse(decrypt(workspace.channelConfigEncrypted)) as ChannelConnectionRecord[];
    } catch {
      channelConnections = [];
    }
  }

  const workspaceWithChannels = { ...workspace, channelConnections };

  // 3. Identify agent roles
  const orchestrator = workspaceWithChannels.agents.find(a => a.role === 'ORCHESTRATOR');
  const critic = workspaceWithChannels.agents.find(a => a.role === 'CRITIC');
  const workers = workspaceWithChannels.agents.filter(a => a.role === 'WORKER');

  if (!orchestrator) throw new Error(`Workspace ${workspaceId} has no Orchestrator agent`);
  if (!critic) throw new Error(`Workspace ${workspaceId} has no Critic agent`);

  // 3. Generate gateway token for platform↔container communication
  const gatewayToken = generateSecureToken();

  // 5. Build all outputs
  const openclawConfig = generateOpenClawConfig(workspaceWithChannels, orchestrator, workers, critic);
  const envFile = generateEnvFile(workspaceWithChannels, gatewayToken);
  const cronJobs = generateCronJobs(workspaceWithChannels, orchestrator);
  const workspaces = generateAllWorkspaceFiles(workspaceWithChannels, orchestrator, workers, critic);

  return {
    'openclaw.json': JSON.stringify(openclawConfig, null, 2),
    '.env': envFile,
    workspaces,
    'cron/jobs.json': JSON.stringify(cronJobs, null, 2),
    gatewayToken,
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
//   - bindings[].agentId must reference an agent in agents.list
// ---------------------------------------------------------------------------

function generateOpenClawConfig(
  workspace: WorkspaceWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
) {
  const allAgents = [orchestrator, ...workers, critic];
  const workerIds = workers.map(w => toAgentId(w.name));
  const criticId = toAgentId(critic.name);

  // Build agents.list - one entry per agent in the Claw
  const agentsList = allAgents.map(agent => {
    const agentId = toAgentId(agent.name);
    const isOrchestrator = agent.role === 'ORCHESTRATOR';

    const entry: Record<string, any> = {
      id: agentId,
      name: agent.name,
      // Each agent gets its own workspace directory
      // OpenClaw resolves these relative to OPENCLAW_STATE_DIR
      workspace: `/home/node/.openclaw/workspace-${agentId}`,
      model: resolveModel(agent.model),
    };

    if (isOrchestrator) {
      entry.default = true;
      // Allow orchestrator to spawn workers and critic as subagents
      entry.subagents = {
        allowAgents: [...workerIds, criticId],
        model: resolveModel(agent.model), // Default model for spawned subagents
      };
    }

    // Per-agent skill filtering: only show relevant skills to each agent
    const agentSkillSlugs = agent.skills.map(as => as.skill.slug);
    if (agentSkillSlugs.length > 0) {
      entry.skills = agentSkillSlugs;
    }

    return entry;
  });

  // Heartbeat config - only the orchestrator runs heartbeats
  const heartbeatConfig: Record<string, any> = {};
  if (orchestrator.heartbeatInterval) {
    heartbeatConfig.every = orchestrator.heartbeatInterval; // e.g. "30m", "1h"
  }

  // Channel config - from setup wizard step 4
  const channelsConfig = generateChannelsConfig(workspace);

  // Skills entries - API keys and env vars for connected tools
  const skillsEntries = generateSkillsEntriesConfig(workspace);

  // Build the final config - ONLY use fields that exist in OpenClaw's Zod schema
  const config: Record<string, any> = {
    gateway: {
      mode: 'local',
      bind: 'lan',  // Required for Docker (0.0.0.0)
      port: 18789,
    },
    agents: {
      defaults: {
        model: resolveModel(orchestrator.model),
        heartbeat: Object.keys(heartbeatConfig).length > 0 ? heartbeatConfig : undefined,
        subagents: {
          // Increase max children for larger Claws (default is 5)
          maxChildrenPerAgent: Math.max(5, workers.length + 1),
          maxSpawnDepth: 2,
        },
      },
      list: agentsList,
    },
    // Only the Orchestrator receives channel messages
    bindings: [
      {
        agentId: toAgentId(orchestrator.name),
        match: { channel: '*' },
      },
    ],
  };

  // Add channels if any are configured
  if (Object.keys(channelsConfig).length > 0) {
    config.channels = channelsConfig;
  }

  // Add skill entries if any tools have credentials
  if (Object.keys(skillsEntries).length > 0) {
    config.skills = { entries: skillsEntries };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Channel Config Generation
// ---------------------------------------------------------------------------
// Channels are configured in openclaw.json under the `channels` key.
// Tokens are passed via env vars (not hardcoded in config).
// OpenClaw auto-discovers tokens from TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, etc.
// ---------------------------------------------------------------------------

function generateChannelsConfig(workspace: WorkspaceWithRelations): Record<string, any> {
  const channels: Record<string, any> = {};

  for (const channel of workspace.channelConnections) {
    switch (channel.channelType) {
      case 'TELEGRAM':
        channels.telegram = {
          // Token auto-discovered from TELEGRAM_BOT_TOKEN env var
          ...(channel.allowedUsers?.length && {
            allowFrom: channel.allowedUsers,
          }),
          groups: { '*': { requireMention: true } },
        };
        break;

      case 'DISCORD':
        channels.discord = {
          // Token auto-discovered from DISCORD_BOT_TOKEN env var
          ...(channel.allowedUsers?.length && {
            allowFrom: channel.allowedUsers.map((u: string) => `user:${u}`),
          }),
          guilds: { '*': { requireMention: true } },
        };
        break;

      case 'SLACK':
        channels.slack = {
          // Tokens auto-discovered from SLACK_BOT_TOKEN + SLACK_APP_TOKEN env vars
        };
        break;

      case 'WHATSAPP':
        channels.whatsapp = {
          dmPolicy: 'pairing',
          ...(channel.allowedUsers?.length && {
            allowFrom: channel.allowedUsers,
          }),
        };
        break;

      case 'MSTEAMS':
        channels.msteams = {
          enabled: true,
        };
        break;
    }
  }

  return channels;
}

// ---------------------------------------------------------------------------
// Skills Entries Config (API keys for tools)
// ---------------------------------------------------------------------------
// Per-skill credentials and env vars live in openclaw.json skills.entries.
// This is how connected tools (HubSpot, Binance, etc.) get their API keys.
// The skill's eligibility check verifies the env var exists before including
// the skill in the catalog.
// ---------------------------------------------------------------------------

function generateSkillsEntriesConfig(
  workspace: WorkspaceWithRelations,
): Record<string, any> {
  const entries: Record<string, any> = {};

  for (const toolConn of workspace.toolConnections) {
    // Only tools with associated skills need entries
    if (!toolConn.skillSlug) continue;

    const entry: Record<string, any> = { enabled: true };

    // Map tool credentials to skill env vars
    if (toolConn.envVarMapping && typeof toolConn.envVarMapping === 'object') {
      const envVars: Record<string, string> = {};
      for (const [envName, encryptedValue] of Object.entries(toolConn.envVarMapping as Record<string, string>)) {
        envVars[envName] = decrypt(encryptedValue);
      }
      if (Object.keys(envVars).length > 0) {
        entry.env = envVars;
      }
    }

    entries[toolConn.skillSlug] = entry;
  }

  return entries;
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

  // AI Provider API keys (decrypted from our DB)
  for (const apiKey of workspace.user.apiKeys) {
    const decrypted = decrypt(apiKey.encryptedKey);
    switch (apiKey.provider) {
      case 'ANTHROPIC':
        lines.push(`ANTHROPIC_API_KEY=${decrypted}`);
        break;
      case 'OPENAI':
        lines.push(`OPENAI_API_KEY=${decrypted}`);
        break;
      case 'GOOGLE':
        lines.push(`GEMINI_API_KEY=${decrypted}`);
        break;
    }
  }
  lines.push('');

  // Channel tokens (decrypted)
  for (const channel of workspace.channelConnections) {
    if (channel.encryptedToken) {
      const token = decrypt(channel.encryptedToken);
      switch (channel.channelType) {
        case 'TELEGRAM':
          lines.push(`TELEGRAM_BOT_TOKEN=${token}`);
          break;
        case 'DISCORD':
          lines.push(`DISCORD_BOT_TOKEN=${token}`);
          break;
        case 'SLACK':
          lines.push(`SLACK_BOT_TOKEN=${token}`);
          if (channel.encryptedAppToken) {
            lines.push(`SLACK_APP_TOKEN=${decrypt(channel.encryptedAppToken)}`);
          }
          break;
      }
    }
  }
  lines.push('');

  // Timezone
  if (workspace.timezone) {
    lines.push(`TZ=${workspace.timezone}`);
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
  orchestrator: AgentWithRelations,
): any[] {
  const jobs: any[] = [];

  // If the orchestrator has a heartbeat schedule, it's handled by the
  // gateway's built-in heartbeat runner (agents.defaults.heartbeat.every),
  // NOT by cron. We only generate cron jobs for additional scheduled tasks.

  // Add any workspace-specific scheduled tasks from the template
  if (workspace.scheduledTasks && Array.isArray(workspace.scheduledTasks)) {
    for (const task of workspace.scheduledTasks) {
      jobs.push({
        name: task.name,
        schedule: parseCronSchedule(task.schedule, task.timezone),
        sessionTarget: task.isolated ? 'isolated' : 'main',
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
): Record<string, AgentWorkspaceFiles> {
  const allAgents = [orchestrator, ...workers, critic];
  const workspaces: Record<string, AgentWorkspaceFiles> = {};

  for (const agent of allAgents) {
    const agentId = toAgentId(agent.name);
    workspaces[`workspace-${agentId}`] = generateAgentWorkspaceFiles(
      workspace,
      agent,
      orchestrator,
      workers,
      critic,
    );
  }

  return workspaces;
}

function generateAgentWorkspaceFiles(
  workspace: WorkspaceWithRelations,
  agent: AgentWithRelations,
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
): AgentWorkspaceFiles {
  const isOrchestrator = agent.role === 'ORCHESTRATOR';
  const isCritic = agent.role === 'CRITIC';
  const clawName = workspace.clawTemplate?.name ?? workspace.name;

  return {
    'SOUL.md': generateSoulMd(agent, clawName),
    'AGENTS.md': generateAgentsMd(agent, orchestrator, workers, critic, clawName),
    'USER.md': generateUserMd(workspace),
    'IDENTITY.md': generateIdentityMd(agent),
    'TOOLS.md': generateToolsMd(workspace, agent),
    'HEARTBEAT.md': isOrchestrator
      ? generateHeartbeatMd(orchestrator, workspace)
      : '# HEARTBEAT.md\n\n# No heartbeat tasks for this agent.\n',
    'BOOT.md': generateBootMd(agent, clawName),
    skills: generateSkillFiles(agent),
  };
}

// ---------------------------------------------------------------------------
// SOUL.md - Agent Identity & Personality
// ---------------------------------------------------------------------------
// Freeform markdown. No required structure. Injected into system prompt.
// Keep concise - this is in every LLM call's token count.
// ---------------------------------------------------------------------------

function generateSoulMd(agent: AgentWithRelations, clawName: string): string {
  // If the agent has custom soulMd from the Builder, use it
  if (agent.soulMd?.trim()) {
    return agent.soulMd;
  }

  // Otherwise, generate from role template
  switch (agent.role) {
    case 'ORCHESTRATOR':
      return generateOrchestratorSoulMd(agent, clawName);
    case 'CRITIC':
      return generateCriticSoulMd(agent, clawName);
    case 'WORKER':
    default:
      return generateWorkerSoulMd(agent, clawName);
  }
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
## Verdict: [APPROVED / REJECTED]
## Score: [1-10]
## Assessment: [2-3 sentences]
## [If REJECTED] Specific Feedback:
- [Point 1: exactly what's wrong and how to fix it]
- [Point 2: if applicable]
## [If any] Risk Flags:
- [Potential issues even if approved]
\`\`\`

# Rules

- Never approve something you wouldn't put your own name on
- Never rewrite the work yourself - give feedback, let the Worker fix it
- If you're unsure, REJECT with a note explaining your uncertainty
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
  clawName: string,
): string {
  // If the agent has custom agentsMd from the Builder, use it
  if (agent.agentsMd?.trim()) {
    // Inject spawn-based routing instructions for orchestrator
    if (agent.role === 'ORCHESTRATOR') {
      return injectSpawnInstructions(agent.agentsMd, workers, critic);
    }
    return agent.agentsMd;
  }

  switch (agent.role) {
    case 'ORCHESTRATOR':
      return generateOrchestratorAgentsMd(orchestrator, workers, critic, clawName);
    case 'CRITIC':
      return generateCriticAgentsMd(critic, clawName);
    case 'WORKER':
    default:
      return generateWorkerAgentsMd(agent, clawName);
  }
}

function generateOrchestratorAgentsMd(
  orchestrator: AgentWithRelations,
  workers: AgentWithRelations[],
  critic: AgentWithRelations,
  clawName: string,
): string {
  const workerList = workers
    .map(w => `- **${w.name}** (agent ID: \`${toAgentId(w.name)}\`): ${w.description || 'Specialized worker'}`)
    .join('\n');

  const criticId = toAgentId(critic.name);

  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read USER.md - this is who you're helping
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
- Provide a clear, complete task description with all necessary context
- The Worker cannot see your conversation history - include everything they need
- You can spawn multiple Workers in parallel for independent tasks
- Maximum ${Math.max(5, workers.length + 1)} concurrent spawned tasks

# Quality Review Flow

After receiving a Worker's output:
1. Spawn the Critic: \`sessions_spawn(agentId: "${criticId}", task: "Review this output: [paste output]. Context: [what it's for].")\`
2. The Critic will respond with a verdict (APPROVED/REJECTED with score and feedback)
3. If APPROVED (score ≥ ${critic.qualityThreshold ?? 8}): Present to the human
4. If REJECTED: Spawn the Worker again with the Critic's feedback included
5. After 3 rejection rounds: Present best attempt with a quality warning to the human

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
3. If nothing needs attention: respond HEARTBEAT_OK
`;
}

function generateCriticAgentsMd(critic: AgentWithRelations, clawName: string): string {
  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read USER.md - understand the human's preferences and context

# Your Role

You are spawned by the Orchestrator to review a specific piece of work. Your response is returned to the Orchestrator automatically.

# Review Process

1. Read the work provided in the task description carefully
2. Evaluate against the criteria in your SOUL.md
3. Score 1-10
4. Respond with the exact verdict format from your SOUL.md
5. Be specific in feedback - the Worker needs to know exactly what to fix

# Quality Threshold

Minimum passing score: ${critic.qualityThreshold ?? 8}/10
`;
}

function generateWorkerAgentsMd(agent: AgentWithRelations, clawName: string): string {
  return `# Session Start Protocol

Every session, before doing anything else:
1. Read SOUL.md - this is who you are
2. Read USER.md - understand the human's context
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

function generateToolsMd(
  workspace: WorkspaceWithRelations,
  agent: AgentWithRelations,
): string {
  const toolSections: string[] = [];

  for (const toolConn of workspace.toolConnections) {
    const section = `### ${toolConn.toolName}
- Connection type: ${toolConn.connectionType}
- Status: Connected
${toolConn.notes ? `- Notes: ${toolConn.notes}` : ''}`;
    toolSections.push(section);
  }

  if (toolSections.length === 0) {
    return `# TOOLS.md - Environment Notes

No external tools are connected yet. The human can connect tools in the Claws setup wizard.
`;
  }

  return `# TOOLS.md - Environment Notes

## Connected Tools

${toolSections.join('\n\n')}

## Notes

- Tool credentials are configured automatically. Use the corresponding skills to interact with these tools.
- If a tool connection fails, advise the human to reconnect in the Claws Settings page.
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
  if (!orchestrator.heartbeatMd?.trim()) {
    return `# HEARTBEAT.md

# Periodic tasks for ${orchestrator.name}
# Add tasks below. The gateway will prompt you to check this file periodically.
# Use checklist format:
# - [ ] Task description
`;
  }

  return orchestrator.heartbeatMd;
}

// ---------------------------------------------------------------------------
// BOOT.md - Startup Hook
// ---------------------------------------------------------------------------
// Runs on every gateway startup (when hooks.internal.enabled is set).
// We use it for startup verification.
// ---------------------------------------------------------------------------

function generateBootMd(agent: AgentWithRelations, clawName: string): string {
  if (agent.role !== 'ORCHESTRATOR') {
    return `# BOOT.md

# No startup tasks for this agent.
`;
  }

  return `# BOOT.md - Startup Checklist

On gateway startup:
1. Read SOUL.md and USER.md to restore context
2. Check memory/ directory for recent activity
3. Verify HEARTBEAT.md has your scheduled tasks
4. If everything looks good, reply with NO_REPLY
5. If something is wrong (missing files, corrupted memory), send a brief status message to the human
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

function generateSkillFiles(
  agent: AgentWithRelations,
): Record<string, { 'SKILL.md': string }> {
  const skills: Record<string, { 'SKILL.md': string }> = {};

  for (const agentSkill of agent.skills) {
    const skill = agentSkill.skill;

    // Build YAML frontmatter
    const metadata: Record<string, any> = {
      openclaw: {
        ...(skill.emoji && { emoji: skill.emoji }),
        ...(skill.requiredBins && skill.requiredBins.length > 0 && {
          requires: { bins: skill.requiredBins },
        }),
      },
    };

    const frontmatter: Record<string, any> = {
      name: skill.slug,
      description: skill.description,
    };

    // Only include metadata if it has content
    if (Object.keys(metadata.openclaw).length > 0) {
      frontmatter.metadata = metadata;
    }

    const yamlStr = yaml.stringify(frontmatter, { lineWidth: 0 });
    const body = skill.skillMd || `# ${skill.name}\n\nNo instructions provided.`;

    skills[skill.slug] = {
      'SKILL.md': `---\n${yamlStr}---\n\n${body}`,
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
  scheduledTasks?: any;
  agents: AgentWithRelations[];
  toolConnections: ToolConnectionRecord[];
  channelConnections: ChannelConnectionRecord[];
  clawTemplate: { name: string; slug: string } | null;
  user: {
    name: string | null;
    apiKeys: { provider: string; encryptedKey: string }[];
  };
};

type AgentWithRelations = {
  id: string;
  name: string;
  role: 'ORCHESTRATOR' | 'WORKER' | 'CRITIC';
  description?: string | null;
  model: string;
  soulMd?: string | null;
  agentsMd?: string | null;
  heartbeatMd?: string | null;
  heartbeatInterval?: string | null;
  qualityThreshold?: number | null;
  emoji?: string | null;
  skills: { skill: SkillRecord }[];
  outgoingConnections: { targetAgent: { name: string }; condition: string }[];
  incomingConnections: { sourceAgent: { name: string } }[];
};

type SkillRecord = {
  slug: string;
  name: string;
  description: string;
  emoji?: string | null;
  requiredBins?: string[] | null;
  skillMd?: string | null;
};

type ToolConnectionRecord = {
  toolName: string;
  connectionType: string;
  skillSlug?: string | null;
  envVarMapping?: any;
  notes?: string | null;
};

type ChannelConnectionRecord = {
  channelType: string;
  encryptedToken?: string | null;
  encryptedAppToken?: string | null;
  allowedUsers?: string[] | null;
};
