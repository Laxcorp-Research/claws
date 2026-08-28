import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/encryption', () => ({
  // Smart decrypt mock: JSON inputs pass through (used for
  // encryptedCredentials fixtures that hold plaintext JSON for easy test
  // writing), non-JSON inputs get the legacy "decrypted-<blob>" prefix
  // which the existing .env / apiKey assertions rely on.
  decrypt: vi.fn((val: string) => {
    if (val.trim().startsWith('{')) {
      try {
        JSON.parse(val);
        return val;
      } catch {
        // fall through
      }
    }
    return `decrypted-${val}`;
  }),
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 4)}...`),
}));

vi.mock('@/lib/crypto', () => ({
  generateSecureToken: vi.fn(() => 'mock-gateway-token-abc123'),
}));

import { generateWorkspace } from '@/lib/openclaw/generator';
import { ANTHROPIC_PROXY_URL } from '@/lib/openclaw/derive-container-env';
import { generateSecureToken } from '@/lib/crypto';

const runtimeChannelsSchema2026052206 = z.object({
  telegram: z.object({
    botToken: z.string().min(1),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groups: z.record(z.string(), z.object({ requireMention: z.boolean().optional() }).strict().optional()).optional(),
  }).passthrough().optional(),
  discord: z.object({
    token: z.string().min(1),
    allowFrom: z.array(z.string()).optional(),
    guilds: z.record(z.string(), z.object({ requireMention: z.boolean().optional() }).strict().optional()).optional(),
  }).passthrough().optional(),
  slack: z.object({
    mode: z.enum(["socket", "http"]).optional(),
    botToken: z.string().min(1),
    appToken: z.string().min(1),
  }).passthrough().optional(),
}).passthrough()

/**
 * Test-only shape matching the subset of ToolConnection fields the generator
 * reads (see the ToolConnectionRecord type in generator.ts). Using this type
 * in test fixtures lets us declare `encryptedCredentials: null` for the
 * skip-path tests without TypeScript inferring a narrower shape.
 *
 * Post-PR #4: includes `composioConnectionId` + `composioEntityId` so OAuth
 * emission tests can build CONNECTED rows. API_KEY tests continue to leave
 * both null (matches the Prisma-level default for those rows).
 */
type TestToolConn = {
  toolSlug: string;
  displayName: string;
  connectionType: 'API_KEY' | 'OAUTH_COMPOSIO' | 'CHANNEL_NATIVE';
  status: string;
  encryptedCredentials: string | null;
  composioConnectionId: string | null;
  composioEntityId: string | null;
};

type TestCustomToolConn = {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'API_KEY_HEADER' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'QUERY_PARAM';
  encryptedCredentials: string;
  description: string | null;
  generatedSkillMd: string | null;
  createdAt: Date;
};

function buildMockWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-test-1',
    name: 'Test Claw',
    slug: 'test-claw',
    status: 'DRAFT',
    userId: 'user-1',
    clawTemplateId: 'tpl-1',
    timezone: 'America/New_York',
    userContext: 'Test user context',
    scheduledTasks: null,
    description: null,
    gatewayToken: null,
    hostPort: null,
    containerName: null,
    apiKeySourceOverride: null,
    // WorkspaceApiKey rows (the setup wizard's per-workspace "Add key"
    // overrides). Default empty; the D6 webchat-silent tests override it.
    apiKeyOverrides: [] as { provider: string; encryptedKey: string }[],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    agents: [
      {
        id: 'agent-orch',
        name: 'Test Commander',
        role: 'ORCHESTRATOR',
        description: 'The orchestrator',
        model: 'HAIKU_4_5',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '- [ ] Check status every 30 minutes',
        heartbeatFrequency: 'hourly',
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        isPaused: false,
        reportsTo: null,
        workspaceId: 'ws-test-1',
        skills: [
          {
            skill: {
              slug: 'tavily-search',
              name: 'Tavily Search',
              description: 'Search the web using Tavily',
              emoji: null,
              requiredBins: null,
              skillMd: '# Tavily Search\n\nSearch the web.',
            },
          },
        ],
        outgoingConnections: [
          { targetAgent: { id: 'agent-worker-1', name: 'Data Analyst' }, condition: 'ON_COMPLETE', contextNote: null },
        ],
        incomingConnections: [],
      },
      {
        id: 'agent-worker-1',
        name: 'Data Analyst',
        role: 'WORKER',
        description: 'Analyzes data',
        model: 'SONNET_4_6',
        soulMd: '# Data Analyst\nYou analyze data.',
        agentsMd: '# Procedures\nAnalyze what the orchestrator asks.',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        isPaused: false,
        reportsTo: 'agent-orch',
        workspaceId: 'ws-test-1',
        skills: [],
        outgoingConnections: [],
        incomingConnections: [{ sourceAgent: { name: 'Test Commander' } }],
      },
      {
        id: 'agent-critic',
        name: 'Quality Reviewer',
        role: 'CRITIC',
        description: 'Reviews outputs',
        model: 'OPUS_4_6',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        isPaused: false,
        reportsTo: 'agent-orch',
        workspaceId: 'ws-test-1',
        skills: [],
        outgoingConnections: [],
        incomingConnections: [{ sourceAgent: { name: 'Test Commander' } }],
      },
    ],
    toolConnections: [
      // Real Prisma ToolConnection shape post-PR #2. encryptedCredentials
      // holds a JSON string that the smart decrypt mock passes through
      // unchanged - the generator then parses it and emits it as the
      // `env` map on the skills.entries slot keyed by toolSlug.
      {
        toolSlug: 'tavily',
        displayName: 'Tavily',
        connectionType: 'API_KEY',
        status: 'CONNECTED',
        encryptedCredentials: JSON.stringify({ TAVILY_API_KEY: 'real-tavily-key' }),
        composioConnectionId: null,
        composioEntityId: null,
      },
    ] as TestToolConn[],
    customToolConnections: [] as TestCustomToolConn[],
    channelConfig: {},
    clawTemplate: { name: 'Test Template', slug: 'test-template' },
    user: {
      id: 'user-1',
      name: 'Test User',
      apiKeySource: 'USER_OWN_KEY',
      apiKeys: [
        { provider: 'ANTHROPIC', encryptedKey: 'encrypted-anthropic-key' },
      ],
    },
  };
}

describe('generateWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace()
    );
    // C-engine B1: the compatible-skills lookup widened from OAuth-only to
    // all emission-eligible connected tools, so the default fixture (one
    // API_KEY row) now triggers skill.findMany. Default to "no curated
    // skills" - tests that need curated rows override per-case.
    (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('returns a GeneratedWorkspace with all required keys', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result).toHaveProperty('openclaw.json');
    expect(result).toHaveProperty('.env');
    expect(result).toHaveProperty('workspaces');
    expect(result).toHaveProperty('cron/jobs.json');
    expect(result).toHaveProperty('gatewayToken');
    expect(result.seedFiles).toEqual({});
  });

  it('emits MEMORY.md per agent and VOICE.md once at shared/ (MUTATION: mix into CLAWS_FILES workspaces → fail)', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({
        seedFiles: [
          { path: 'memory/MEMORY.md', content: '# MEMORY.md\nMaintained by this agent.\n' },
          { path: 'VOICE.md', content: '# VOICE.md\nMaintained by content-writer.\n' },
        ],
      }),
    );
    const result = await generateWorkspace('ws-test-1');
    const dirs = Object.keys(result.workspaces);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    expect(result.seedFiles?.['shared/VOICE.md']).toContain('content-writer');
    expect(Object.keys(result.seedFiles ?? {}).filter((k) => k.endsWith('/VOICE.md') || k === 'VOICE.md')).toEqual([
      'shared/VOICE.md',
    ]);
    for (const dir of dirs) {
      expect(result.seedFiles?.[`${dir}/memory/MEMORY.md`]).toContain('Maintained by this agent');
      expect(result.seedFiles?.[`${dir}/VOICE.md`]).toBeUndefined();
      expect(result.workspaces[dir]).not.toHaveProperty('VOICE.md');
      expect(result.workspaces[dir]).not.toHaveProperty('memory/MEMORY.md');
    }
  });

  it('buyer-independence: unpublished sold template still generates from workspace snapshot', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({
        clawTemplate: {
          name: 'Sold Template',
          slug: 'sold-template',
          isPublished: false,
          reviewStatus: 'APPROVED',
        },
      }),
    )
    const result = await generateWorkspace('ws-test-1')
    expect(result).toHaveProperty('openclaw.json')
    const config = JSON.parse(result['openclaw.json']) as { agents: { list: unknown[] } }
    expect(config.agents.list).toHaveLength(3)
  })

  it('generates valid JSON for openclaw.json', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.gateway).toBeDefined();
    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.mode).toBe('local');
    expect(config.gateway.bind).toBe('lan');

    expect(config.agents).toBeDefined();
    expect(config.agents.list).toHaveLength(3);
  });

  it('Lifecycle P6: openclaw.json tools.deny includes dir_list (mutation: drop merge → fail)', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']) as { tools?: { deny?: string[] } };
    expect(config.tools?.deny).toContain('dir_list');
  });

  it('D6-b: zero-channel claw denies the message tool globally (CLI-leak source removed)', async () => {
    // Default fixture has no channelConfigEncrypted = zero external channels.
    // The runtime message tool can only fail there, and its error text tells
    // the HUMAN to run "openclaw channels add" - which the model parrots.
    // Denied tools never reach the model's tool list. Mutation: drop the
    // mergeMessageDenyIntoTools call → this fails.
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']) as { tools?: { deny?: string[] } };
    expect(config.tools?.deny).toContain('message');
    expect(config.tools?.deny).toContain('dir_list');
  });

  it('D6-b: connected-channel claw keeps the message tool available', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({
        channelConfigEncrypted: JSON.stringify({
          telegram: { botToken: '123456789:telegram-token', allowFrom: ['424242'] },
        }),
      }),
    );
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']) as { tools?: { deny?: string[] } };
    expect(config.tools?.deny).not.toContain('message');
    expect(config.tools?.deny).toContain('dir_list');
  });

  it('D6-b: every agent TOOLS.md teaches webchat delivery; zero-channel prose never mentions channel CLI', async () => {
    const result = await generateWorkspace('ws-test-1');
    const workspaces = Object.values(result.workspaces);
    expect(workspaces.length).toBeGreaterThan(0);
    for (const files of workspaces) {
      const toolsMd = files['TOOLS.md'];
      expect(toolsMd).toContain('## Message Delivery');
      expect(toolsMd).toContain('Claws dashboard web chat');
      expect(toolsMd).toContain('built in and always active');
      // The exact CLI strings the founder saw in the D6-b reply.
      expect(toolsMd).not.toContain('channels add');
      expect(toolsMd).not.toContain('channels list');
    }
  });

  it('D6-b: connected claw TOOLS.md names the connected channels', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({
        channelConfigEncrypted: JSON.stringify({
          telegram: { botToken: '123456789:telegram-token', allowFrom: ['424242'] },
          slack: { mode: 'socket', botToken: 'xoxb-slack-bot', appToken: 'xapp-slack-app' },
        }),
      }),
    );
    const result = await generateWorkspace('ws-test-1');
    const workspaces = Object.values(result.workspaces);
    for (const files of workspaces) {
      const toolsMd = files['TOOLS.md'];
      expect(toolsMd).toContain('Connected external channels: Telegram, Slack');
    }
  });

  it('round-trips route-written channel config into the 2026.5.22-6 runtime channel schema', async () => {
    const routeWrittenPlaintext = JSON.stringify({
      telegram: { botToken: '123456789:telegram-token', allowFrom: ['424242'] },
      discord: { token: 'discord-token', allowFrom: ['987654321'] },
      slack: { mode: 'socket', botToken: 'xoxb-slack-bot', appToken: 'xapp-slack-app' },
    });
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({ channelConfigEncrypted: routeWrittenPlaintext }),
    );

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(() => runtimeChannelsSchema2026052206.parse(config.channels)).not.toThrow();
    expect(config.channels).toEqual({
      telegram: {
        botToken: '123456789:telegram-token',
        allowFrom: ['424242'],
        groups: { '*': { requireMention: true } },
      },
      discord: {
        token: 'discord-token',
        allowFrom: ['987654321'],
        guilds: { '*': { requireMention: true } },
      },
      slack: {
        mode: 'socket',
        botToken: 'xoxb-slack-bot',
        appToken: 'xapp-slack-app',
      },
    });
    expect(result['.env']).toContain('TELEGRAM_BOT_TOKEN=123456789:telegram-token');
    expect(result['.env']).toContain('DISCORD_BOT_TOKEN=discord-token');
    expect(result['.env']).toContain('SLACK_BOT_TOKEN=xoxb-slack-bot');
    expect(result['.env']).toContain('SLACK_APP_TOKEN=xapp-slack-app');
  });

  it('includes configured channels in the first deploy config for a never-deployed workspace', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({
        status: 'DRAFT',
        containerId: null,
        containerHost: null,
        channelConfigEncrypted: JSON.stringify({
          telegram: { botToken: '123456789:telegram-token', allowFrom: ['424242'] },
        }),
      }),
    );

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.channels.telegram).toEqual({
      botToken: '123456789:telegram-token',
      allowFrom: ['424242'],
      groups: { '*': { requireMention: true } },
    });
  });

  it('maps model enums to provider/model format', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    const orchestrator = config.agents.list.find(
      (a: Record<string, unknown>) => a.name === 'Test Commander'
    );
    expect(orchestrator).toBeDefined();
    expect(orchestrator.model).toBe('anthropic/claude-haiku-4-5-20251001');

    const worker = config.agents.list.find(
      (a: Record<string, unknown>) => a.name === 'Data Analyst'
    );
    expect(worker!.model).toBe('anthropic/claude-sonnet-4-6');

    const critic = config.agents.list.find(
      (a: Record<string, unknown>) => a.name === 'Quality Reviewer'
    );
    expect(critic!.model).toBe('anthropic/claude-opus-4-6');
  });

  it('emits agents.list[].thinkingDefault only for a valid stored level', async () => {
    const ws = buildMockWorkspace();
    const agents = ws.agents as Array<Record<string, unknown>>;
    agents[0].thinkingDefault = 'high';       // valid → emitted
    agents[1].thinkingDefault = 'turbo';      // invalid → omitted
    agents[2].thinkingDefault = null;         // null → omitted (runtime default)
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    const byName = (name: string) =>
      config.agents.list.find((a: Record<string, unknown>) => a.name === name);

    expect(byName('Test Commander').thinkingDefault).toBe('high');
    expect(byName('Data Analyst')).not.toHaveProperty('thinkingDefault');
    expect(byName('Quality Reviewer')).not.toHaveProperty('thinkingDefault');
  });

  it('creates flat workspace directories per agent', async () => {
    const result = await generateWorkspace('ws-test-1');

    const workspaceKeys = Object.keys(result.workspaces);
    expect(workspaceKeys).toHaveLength(3);

    for (const wsKey of workspaceKeys) {
      const ws = result.workspaces[wsKey];
      expect(ws['SOUL.md']).toBeDefined();
      expect(ws['AGENTS.md']).toBeDefined();
      expect(ws['USER.md']).toBeDefined();
      expect(ws['IDENTITY.md']).toBeDefined();
      expect(ws['TOOLS.md']).toBeDefined();
      expect(ws['HEARTBEAT.md']).toBeDefined();
      expect(ws['BOOT.md']).toBeDefined();
      expect(ws.skills).toBeDefined();
    }
  });

  it('includes decrypted API keys in .env', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result['.env']).toContain('ANTHROPIC_API_KEY=decrypted-encrypted-anthropic-key');
    expect(result['.env']).toContain('OPENCLAW_GATEWAY_TOKEN=mock-gateway-token-abc123');
  });

  // ─── D6 2026-08-23 webchat-silent regression ──────────────────────────
  //
  // Founder's workspace: OpenRouter key stored ONLY as a WorkspaceApiKey
  // (the setup wizard's "Add key" override), zero UserApiKey rows. The old
  // generateEnvFile iterated workspace.user.apiKeys exclusively, so the
  // container .env had no OPENROUTER_API_KEY - every agent turn died with
  // 'No API key found for provider "openrouter"' before replying (gateway
  // acked chat.send, then silence). These tests fail if the override read
  // is ever stripped again.
  describe('workspace override keys reach .env (D6 webchat-silent)', () => {
    it('override-only OpenRouter key is baked when the user has no global keys', async () => {
      const ws = buildMockWorkspace({
        apiKeyOverrides: [{ provider: 'OPENROUTER', encryptedKey: 'enc-ws-openrouter' }],
      });
      ws.user.apiKeys = [];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');

      expect(result['.env']).toContain('OPENROUTER_API_KEY=decrypted-enc-ws-openrouter');
    });

    it('workspace override wins over the user-level key for the same provider', async () => {
      const ws = buildMockWorkspace({
        apiKeyOverrides: [{ provider: 'OPENROUTER', encryptedKey: 'enc-ws-or' }],
      });
      ws.user.apiKeys = [{ provider: 'OPENROUTER', encryptedKey: 'enc-user-or' }];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');

      expect(result['.env']).toContain('OPENROUTER_API_KEY=decrypted-enc-ws-or');
      expect(result['.env']).not.toContain('decrypted-enc-user-or');
    });

    it('OPENAI and GOOGLE overrides emit OPENAI_API_KEY / GEMINI_API_KEY', async () => {
      const ws = buildMockWorkspace({
        apiKeyOverrides: [
          { provider: 'OPENAI', encryptedKey: 'enc-ws-openai' },
          { provider: 'GOOGLE', encryptedKey: 'enc-ws-google' },
        ],
      });
      ws.user.apiKeys = [];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');

      expect(result['.env']).toContain('OPENAI_API_KEY=decrypted-enc-ws-openai');
      expect(result['.env']).toContain('GEMINI_API_KEY=decrypted-enc-ws-google');
    });

    it('ANTHROPIC seam: a workspace ANTHROPIC override is NOT emitted (user-key path unchanged)', async () => {
      // Anthropic is deliberately out of scope here: its key rides TWO
      // surfaces (generator .env AND deriveContainerEnv → Railway env +
      // reconciliation-cron fingerprints + the credit proxy). Moving only
      // the .env half would let the two surfaces disagree about which key
      // wins. This test locks the seam so widening it is a conscious,
      // both-surfaces change.
      const ws = buildMockWorkspace({
        apiKeyOverrides: [{ provider: 'ANTHROPIC', encryptedKey: 'enc-ws-anthropic' }],
      });
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');

      expect(result['.env']).toContain('ANTHROPIC_API_KEY=decrypted-encrypted-anthropic-key');
      expect(result['.env']).not.toContain('decrypted-enc-ws-anthropic');
    });
  });

  it('generates a gateway token', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result.gatewayToken).toBe('mock-gateway-token-abc123');
  });

  it('reuses an existing gateway token instead of rotating on redeploy', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({ gatewayToken: 'enc-existing-gateway-token' }),
    );

    const result = await generateWorkspace('ws-test-1');

    expect(result.gatewayToken).toBe('decrypted-enc-existing-gateway-token');
    expect(result['.env']).toContain('OPENCLAW_GATEWAY_TOKEN=decrypted-enc-existing-gateway-token');
    expect(generateSecureToken).not.toHaveBeenCalled();
  });

  it('mints a gateway token only when the workspace has none', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result.gatewayToken).toBe('mock-gateway-token-abc123');
    expect(generateSecureToken).toHaveBeenCalledTimes(1);
  });

  it('first deploy claims the token atomically (conditional write on gatewayToken=null)', async () => {
    await generateWorkspace('ws-test-1');

    // D6 2026-08-22: two concurrent first deploys each minted a different
    // token via a bare read-then-mint; DB and container ended up with
    // different tokens and every health probe 401'd (bad-token).
    // MUTATION: restoring the bare mint removes this write entirely.
    expect(prismaMock.workspace.updateMany).toHaveBeenCalledWith({
      where: { id: 'ws-test-1', gatewayToken: null },
      data: { gatewayToken: 'encrypted-mock-gateway-token-abc123' },
    });
  });

  it('losing the first-deploy race adopts the winner token (never its own mint)', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(buildMockWorkspace()) // workspace graph: token null
      .mockResolvedValueOnce({ gatewayToken: 'enc-winner-token' } as never); // claim re-read

    const result = await generateWorkspace('ws-test-1');

    expect(result.gatewayToken).toBe('decrypted-enc-winner-token');
    expect(result['.env']).toContain('OPENCLAW_GATEWAY_TOKEN=decrypted-enc-winner-token');
  });

  it('existing token skips the claim write entirely', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace({ gatewayToken: 'enc-existing-gateway-token' }),
    );

    await generateWorkspace('ws-test-1');

    expect(prismaMock.workspace.updateMany).not.toHaveBeenCalled();
  });

  it('includes skill files for agents with assigned skills', async () => {
    const result = await generateWorkspace('ws-test-1');

    const orchKey = Object.keys(result.workspaces).find(k =>
      k.includes('test-commander')
    );
    expect(orchKey).toBeDefined();
    const orchWorkspace = result.workspaces[orchKey!];
    expect(orchWorkspace.skills['tavily-search']).toBeDefined();
    expect(orchWorkspace.skills['tavily-search']['SKILL.md']).toContain('tavily-search');
  });

  it('throws if workspace not found', async () => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Not found')
    );

    await expect(generateWorkspace('nonexistent')).rejects.toThrow();
  });

  // WIRE-FULL: fenced Workflow section from ORCH→WORKER edges + law knobs.
  describe('WIRE-FULL: orchestrator AGENTS.md fenced Workflow section', () => {
    function orchestratorAgentsMd(result: Awaited<ReturnType<typeof generateWorkspace>>): string {
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      expect(orchKey).toBeDefined();
      return result.workspaces[orchKey!]['AGENTS.md'];
    }

    it('emits fenced ## Workflow with unconditional delegation + law section (snapshot)', async () => {
      const result = await generateWorkspace('ws-test-1');
      const agentsMd = orchestratorAgentsMd(result);

      expect(agentsMd).toContain('<!-- claws:workflow:begin -->');
      expect(agentsMd).toContain('<!-- claws:workflow:end -->');
      expect(agentsMd).toContain('Delegate work to Data Analyst.');
      expect(agentsMd).toContain('Quality Reviewer reviews every worker output');
      expect(agentsMd).toContain('Scores below 8 loop back for revision (max 3)');
      // X2: no condition labels in emission.
      expect(agentsMd).not.toContain('on-complete');
      expect(agentsMd).not.toContain('→');
    });

    it('emission identical across ConnectionCondition values (X2)', async () => {
      const base = buildMockWorkspace();
      const orch = (base.agents as Array<Record<string, unknown>>)[0]!;
      orch.outgoingConnections = [
        { targetAgent: { id: 'agent-worker-1', name: 'Data Analyst' }, condition: 'ON_APPROVAL', contextNote: null },
      ];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
      const a = await generateWorkspace('ws-test-1');
      const mdA = orchestratorAgentsMd(a);

      orch.outgoingConnections = [
        { targetAgent: { id: 'agent-worker-1', name: 'Data Analyst' }, condition: 'ON_REJECTION', contextNote: null },
      ];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
      const b = await generateWorkspace('ws-test-1');
      const mdB = orchestratorAgentsMd(b);

      const fence = (md: string) =>
        md.slice(md.indexOf('<!-- claws:workflow:begin -->'), md.indexOf('<!-- claws:workflow:end -->'));
      expect(fence(mdA)).toBe(fence(mdB));
    });

    it('omits paused workers from fence sentences; still emits law', async () => {
      const base = buildMockWorkspace();
      const worker = (base.agents as Array<Record<string, unknown>>).find((a) => a.role === 'WORKER')!;
      worker.isPaused = true;
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
      const result = await generateWorkspace('ws-test-1');
      const md = orchestratorAgentsMd(result);
      expect(md).toContain('_(no worker connections)_');
      expect(md).toContain('Quality Reviewer reviews every worker output');
      expect(md).not.toContain('Delegate work to Data Analyst');
    });

    it('MUTATION: fence application must use applyWorkflowFence (bypass → fail)', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = readFileSync(join(process.cwd(), 'src/lib/openclaw/generator.ts'), 'utf8');
      expect(src).toContain('applyWorkflowFence');
      expect(src).toContain('generateFencedWorkflowSection');
      expect(src).toContain('deriveAllowAgents');
    });
  });

  // L2 (PR-C #12): mandated final heartbeat step - write memory files even
  // when nothing needed attention (closes the 21:00 analytics-job gap where
  // a heartbeat run left no memory trail).
  describe('L2: heartbeat protocol memory mandate', () => {
    it('mandates writing memory/[today].md + MEMORY.md as the final heartbeat step', async () => {
      const result = await generateWorkspace('ws-test-1');
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      const md = result.workspaces[orchKey!]['AGENTS.md'];

      expect(md).toContain('# Heartbeat Protocol');
      const heartbeatSection = md.slice(md.indexOf('# Heartbeat Protocol'));
      expect(heartbeatSection).toContain(
        '4. MANDATORY final step, every heartbeat run - including the step 3 no-op case: write memory/[today\'s date].md summarizing what happened this run, and update memory/MEMORY.md with any long-term learnings. Do not end a heartbeat run without writing memory - it is the human\'s only audit trail for unattended runs.',
      );
    });

    it('MUTATION: removing the mandatory memory step from the Heartbeat Protocol text fails this test', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = readFileSync(join(process.cwd(), 'src/lib/openclaw/generator.ts'), 'utf8');
      expect(src).toContain('MANDATORY final step, every heartbeat run');
      expect(src).toContain('memory/MEMORY.md with any long-term learnings');
    });
  });

  describe('BOOT.md memory path (EISDIR)', () => {
    it('ORCHESTRATOR BOOT.md uses dated memory file - never Check memory/ directory', async () => {
      const result = await generateWorkspace('ws-test-1');
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      const boot = result.workspaces[orchKey!]['BOOT.md'];
      expect(boot).not.toContain('Check memory/ directory');
      expect(boot).toContain('memory/YYYY-MM-DD.md');
      expect(boot).toMatch(/never .*read.* memory\//i);
    });

    it('includes Twitter interview pack until the workspace flag is set', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...buildMockWorkspace({ userMdInterviewCompletedAt: null }),
        clawTemplate: { name: 'Twitter/X Growth Machine', slug: 'twitter-growth-machine' },
      });
      const result = await generateWorkspace('ws-test-1');
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      const boot = result.workspaces[orchKey!]['BOOT.md'];
      expect(boot).toContain('## First-boot interview');
      expect(boot).toContain('do_not:');
      expect(boot).toContain('/home/node/.openclaw/shared/USER.md');
    });

    it('omits interview pack after userMdInterviewCompletedAt (MUTATION: re-interview on redeploy → fail)', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...buildMockWorkspace({ userMdInterviewCompletedAt: new Date('2026-08-27T00:00:00.000Z') }),
        clawTemplate: { name: 'Twitter/X Growth Machine', slug: 'twitter-growth-machine' },
      });
      const result = await generateWorkspace('ws-test-1');
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      const boot = result.workspaces[orchKey!]['BOOT.md'];
      expect(boot).not.toContain('## First-boot interview');
      expect(boot).not.toContain('do_not:');
      expect(boot).toContain('update my profile');
    });

    it('MUTATION: restoring Check memory/ directory in generateBootMd fails', async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = readFileSync(join(process.cwd(), 'src/lib/openclaw/generator.ts'), 'utf8');
      const bootStart = src.indexOf('function generateBootMd');
      expect(bootStart).toBeGreaterThanOrEqual(0);
      const bootFn = src.slice(bootStart, bootStart + 900);
      expect(bootFn).not.toContain('Check memory/ directory');
      expect(bootFn).toContain('memory/YYYY-MM-DD.md');
    });
  });

  it('includes tool connection credentials in skills entries (keyed by toolSlug)', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.skills).toBeDefined();
    // Post-PR #2: skills.entries is keyed by toolSlug (not a phantom
    // skillSlug). PR #3 may revisit keying by skill slug via
    // Skill.compatibleTools lookup, but PR #2 keys by toolSlug per the
    // migration contract.
    expect(config.skills.entries.tavily).toBeDefined();
    expect(config.skills.entries.tavily.enabled).toBe(true);
    expect(config.skills.entries.tavily.env.TAVILY_API_KEY).toBe('real-tavily-key');
  });

  it('A4: removed + disconnected tool emits no skills.entries / TOOLS.md line (mutation: reinstate emission → fail)', async () => {
    const ws = buildMockWorkspace();
    // Tool customization: slug dropped from requirement set AND ToolConnection gone.
    ws.toolConnections = [];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
    (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    expect(config.skills?.entries?.tavily).toBeUndefined();
    // MUTATION: if generator re-emits tavily without a connection, this fails.
    expect(JSON.stringify(config.skills?.entries ?? {})).not.toContain('tavily');

    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
    expect(orchKey).toBeDefined();
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'] ?? '';
    expect(toolsMd).not.toMatch(/###\s*Tavily\b/);
    expect(toolsMd).not.toContain('tavily');
  });

  it('emits custom API skill files, TOOLS.md line, and skills.entries env mapping (mutation guard: dropping env injection fails)', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [];
    ws.customToolConnections = [
      {
        id: 'cust_crm_1',
        name: 'Internal CRM',
        baseUrl: 'https://crm.example.com/v1',
        authType: 'API_KEY_HEADER',
        encryptedCredentials: JSON.stringify({ credential: 'crm-secret-key' }),
        description: 'Lookup customer renewals.',
        generatedSkillMd: null,
        createdAt: new Date('2026-07-06T10:00:00.000Z'),
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    const customSlug = 'custom-internal-crm';
    const envVar = 'CUSTOM_CUSTOM_INTERNAL_CRM_KEY';

    expect(config.skills.entries[customSlug]).toEqual({
      enabled: true,
      env: { [envVar]: 'crm-secret-key' },
    });
    for (const agent of config.agents.list) {
      expect(agent.skills).toContain(customSlug);
    }

    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
    const customSkill = result.workspaces[orchKey!].skills[customSlug]['SKILL.md'];
    expect(customSkill).toContain('# Internal CRM');
    expect(customSkill).toContain('https://crm.example.com/v1');
    expect(customSkill).toContain('## What this API is for');
    expect(customSkill).toContain('Lookup customer renewals.');
    expect(customSkill).toContain(`X-API-Key: $${envVar}`);
    expect(customSkill).toContain('User-provided API - verify responses; report failures honestly');

    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];
    expect(toolsMd).toContain('## Custom APIs');
    expect(toolsMd).toContain('**Internal CRM**: Lookup customer renewals.');
    expect(toolsMd).not.toContain('crm-secret-key');
  });

  it('emits a multi-cred env map when the tool has multiple credential fields', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [
      {
        toolSlug: 'binance',
        displayName: 'Binance',
        connectionType: 'API_KEY',
        status: 'CONNECTED',
        encryptedCredentials: JSON.stringify({
          BINANCE_API_KEY: 'binance-key-real',
          BINANCE_API_SECRET: 'binance-secret-real',
        }),
        composioConnectionId: null,
        composioEntityId: null,
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.skills.entries.binance).toBeDefined();
    expect(config.skills.entries.binance.env).toEqual({
      BINANCE_API_KEY: 'binance-key-real',
      BINANCE_API_SECRET: 'binance-secret-real',
    });
  });

  it('skips ToolConnection rows with status=NEEDS_CREDENTIALS', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [
      {
        toolSlug: 'alpaca',
        displayName: 'Alpaca',
        connectionType: 'API_KEY',
        status: 'NEEDS_CREDENTIALS',
        encryptedCredentials: JSON.stringify({ ALPACA_API_KEY_ID: 'partial-only' }),
        composioConnectionId: null,
        composioEntityId: null,
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    // skills.entries omitted entirely when nothing qualifies (generator
    // only adds the `skills` key when the map has content).
    expect(config.skills).toBeUndefined();
  });

  it('skips OAUTH_COMPOSIO rows when COMPOSIO_API_KEY is unset (no-op; preserves pre-PR #4 behavior for unconfigured envs)', async () => {
    const prev = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    try {
      const ws = buildMockWorkspace();
      ws.toolConnections = [
        {
          toolSlug: 'gmail',
          displayName: 'Gmail',
          connectionType: 'OAUTH_COMPOSIO',
          status: 'CONNECTED',
          encryptedCredentials: null,
          composioConnectionId: 'ca_fake_123',
          composioEntityId: 'claws_user-1',
        },
      ];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      expect(config.skills).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.COMPOSIO_API_KEY;
      else process.env.COMPOSIO_API_KEY = prev;
    }
  });

  it('skips rows with null encryptedCredentials', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [
      {
        toolSlug: 'sendgrid',
        displayName: 'SendGrid',
        connectionType: 'API_KEY',
        status: 'PENDING',
        encryptedCredentials: null,
        composioConnectionId: null,
        composioEntityId: null,
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    expect(config.skills).toBeUndefined();
  });

  it('TOOLS.md uses displayName (not the phantom toolName) for the section header', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [
      {
        toolSlug: 'tavily',
        displayName: 'My Custom Tavily',
        connectionType: 'API_KEY',
        status: 'CONNECTED',
        encryptedCredentials: JSON.stringify({ TAVILY_API_KEY: 'k' }),
        composioConnectionId: null,
        composioEntityId: null,
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const orchKey = Object.keys(result.workspaces).find((k) =>
      k.includes('test-commander'),
    );
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];
    expect(toolsMd).toContain('### My Custom Tavily');
    // Regression guard against the phantom-fields bug (PR #11): no
    // `### undefined` section.
    expect(toolsMd).not.toContain('### undefined');
  });

  it('TOOLS.md falls back to catalog name when displayName is empty', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = [
      {
        toolSlug: 'sendgrid',
        displayName: '',
        connectionType: 'API_KEY',
        status: 'CONNECTED',
        encryptedCredentials: JSON.stringify({ SENDGRID_API_KEY: 'k' }),
        composioConnectionId: null,
        composioEntityId: null,
      },
    ];
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const orchKey = Object.keys(result.workspaces).find((k) =>
      k.includes('test-commander'),
    );
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];
    expect(toolsMd).toContain('### SendGrid');
  });

  it('TOOLS.md directs tool failures to Claws Manage Tools without internal runtime instructions', async () => {
    const result = await generateWorkspace('ws-test-1');
    const orchKey = Object.keys(result.workspaces).find((k) =>
      k.includes('test-commander'),
    );
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];

    expect(toolsMd).toContain('Claws platform');
    expect(toolsMd).toContain('Manage Tools');
    expect(toolsMd).not.toContain('OpenClaw');
    expect(toolsMd).not.toContain('localhost');
  });

  it('sets orchestrator as default agent with subagents config', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    const orchestrator = config.agents.list.find(
      (a: Record<string, unknown>) => a.name === 'Test Commander'
    );
    expect(orchestrator.default).toBe(true);
    expect(orchestrator.subagents).toBeDefined();
    expect(orchestrator.subagents.allowAgents).toContain('data-analyst');
    expect(orchestrator.subagents.allowAgents).toContain('quality-reviewer');
  });

  it('B-hardening: no subagents.model anywhere; orchestrator requireAgentId; worker models intact', async () => {
    // Mutation: re-add orchestrator subagents.model → JSON.stringify match fails.
    // Mutation: drop requireAgentId → expect(true) fails.
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    const list = config.agents.list as Array<{
      id: string;
      name: string;
      model: string;
      subagents?: { model?: string; requireAgentId?: boolean; allowAgents?: string[] };
    }>;

    const blob = JSON.stringify(config);
    expect(blob).not.toMatch(/"subagents"\s*:\s*\{[^}]*"model"/);
    for (const entry of list) {
      expect(entry.subagents?.model).toBeUndefined();
    }
    expect(config.agents.defaults?.subagents?.model).toBeUndefined();

    const orchestrator = list.find((a) => a.name === 'Test Commander');
    expect(orchestrator?.subagents?.requireAgentId).toBe(true);

    const worker = list.find((a) => a.name === 'Data Analyst');
    const critic = list.find((a) => a.name === 'Quality Reviewer');
    expect(worker?.subagents).toBeUndefined();
    expect(critic?.subagents).toBeUndefined();
    expect(worker?.model).toBeTruthy();
    expect(critic?.model).toBeTruthy();
    expect(worker?.model).not.toBe(orchestrator?.model);
  });

  it('B-hardening: orchestrator TOOLS.md belt-line requires agentId and forbids model param', async () => {
    const result = await generateWorkspace('ws-test-1');
    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
    const workerKey = Object.keys(result.workspaces).find((k) => k.includes('data-analyst'));
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];
    expect(toolsMd).toContain(
      'Always pass `agentId` on `sessions_spawn`; never pass a model param (models are configured per-agent).',
    );
    expect(result.workspaces[workerKey!]['TOOLS.md']).not.toContain('## Subagent Spawn');
  });

  it('MUTATION-anchored: .env TZ=UTC even when workspace.timezone is non-UTC; cron schedule.tz untouched', async () => {
    // Fixture timezone is America/New_York. Dropping TZ=UTC force in generateEnvFile fails.
    const ws = buildMockWorkspace();
    const orch = ws.agents.find((a) => a.role === 'ORCHESTRATOR')! as Record<string, unknown>;
    orch.heartbeatFrequency = 'daily';
    orch.heartbeatTime = '08:00';
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    expect(result['.env']).toMatch(/^TZ=UTC$/m);
    expect(result['.env']).not.toContain('TZ=America/New_York');

    const cronJobs = JSON.parse(result['cron/jobs.json']) as Array<{
      schedule?: { tz?: string }
    }>;
    const heartbeatJob = cronJobs.find((j) => j.schedule?.tz);
    expect(heartbeatJob?.schedule?.tz).toBe('America/New_York');
  });

  it('MUTATION-anchored: disables tools.web.search when no search backend is connected', async () => {
    const ws = buildMockWorkspace();
    ws.toolConnections = []; // no tavily/brave/exa/serp
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    // Dropping the workspaceHasSearchBackend gate (always omit enabled:false) fails.
    expect(config.tools?.web?.search?.enabled).toBe(false);

    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
    const toolsMd = result.workspaces[orchKey!]['TOOLS.md'];
    expect(toolsMd).toContain('## Web Search');
    expect(toolsMd).toContain('web_search');
    expect(toolsMd).toContain('web_fetch');
    expect(toolsMd).toContain('Manage Tools');
  });

  it('leaves tools.web.search enabled (no enabled:false) when a search backend is connected', async () => {
    // Default fixture has CONNECTED tavily - wiring finding: only skills.entries,
    // not tools.web.search provider/apiKey. We still leave web_search enabled.
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    expect(config.tools?.web?.search?.enabled).not.toBe(false);
    expect(config.skills.entries.tavily.enabled).toBe(true);
    expect(config.skills.entries.tavily.env.TAVILY_API_KEY).toBe('real-tavily-key');
    // Finding: connecting Tavily wires skills.entries only - nothing reaches tools.web.search.
    expect(config.tools?.web?.search?.apiKey).toBeUndefined();
    expect(config.tools?.web?.search?.provider).toBeUndefined();

    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
    expect(result.workspaces[orchKey!]['TOOLS.md']).not.toContain('## Web Search');
  });

  it('emits NO bindings key - Orchestrator routing is via default:true (#117, dead config removed)', async () => {
    // Regression guard: we used to emit
    //   bindings: [{ agentId: <orchestrator>, match: { channel: '*' } }]
    // believing it routed all channels to the Orchestrator. Upstream's binding
    // index is an exact-string map (channel:'*' matches nothing); routing
    // works via the default-agent fallback. The dead key misled readers, so
    // the generator must not emit it - and the actual mechanism must hold.
    // See docs/OPENCLAW_GATEWAY_PROTOCOL.md §4 / §8 risk 2.
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config).not.toHaveProperty('bindings');
    const defaults = config.agents.list.filter(
      (a: Record<string, unknown>) => a.default === true
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Test Commander');
  });

  it('K3 fallback: paused Workers are excluded from runtime agents and get Orchestrator guidance', async () => {
    const ws = buildMockWorkspace();
    ws.agents[1].isPaused = true;
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);
    const worker = config.agents.list.find((a: Record<string, unknown>) => a.name === 'Data Analyst');
    const orchestrator = config.agents.list.find((a: Record<string, unknown>) => a.name === 'Test Commander');
    const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));

    expect(worker).toBeUndefined();
    expect(orchestrator.subagents.allowAgents).not.toContain('data-analyst');
    expect(result.workspaces[orchKey!]['TOOLS.md']).toContain('Worker Data Analyst is paused - do not delegate to it.');
  });

  it('only orchestrator has meaningful HEARTBEAT.md', async () => {
    const result = await generateWorkspace('ws-test-1');

    const orchKey = Object.keys(result.workspaces).find(k =>
      k.includes('test-commander')
    );
    const workerKey = Object.keys(result.workspaces).find(k =>
      k.includes('data-analyst')
    );

    expect(result.workspaces[orchKey!]['HEARTBEAT.md']).toContain('Check status');
    expect(result.workspaces[workerKey!]['HEARTBEAT.md']).toContain(
      'No heartbeat tasks'
    );
  });

  // ============================================================================
  // OAUTH_COMPOSIO emission (PR #4)
  // Docs: docs/COMPOSIO_RUNTIME_CONTRACT.md §"Emission shape"
  // Each test sets COMPOSIO_API_KEY explicitly in a try/finally so the state
  // cannot leak between tests (vitest doesn't isolate process.env by default).
  // ============================================================================
  describe('OAUTH_COMPOSIO emission (option iv per-request proxy)', () => {
    function withComposioEnv<T>(fn: () => Promise<T>): Promise<T> {
      const prev = process.env.COMPOSIO_API_KEY;
      process.env.COMPOSIO_API_KEY = 'ak_test_platform_key';
      return fn().finally(() => {
        if (prev === undefined) delete process.env.COMPOSIO_API_KEY;
        else process.env.COMPOSIO_API_KEY = prev;
      });
    }

    it('emits the exact Composio envelope for each compatible Skill when COMPOSIO_API_KEY is set', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            toolSlug: 'gmail',
            displayName: 'Gmail',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_gmail_abc',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { slug: 'gmail-outreach', compatibleTools: ['gmail'] },
        ]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);

        expect(config.skills).toBeDefined();
        expect(config.skills.entries['gmail-outreach']).toEqual({
          enabled: true,
          env: {
            COMPOSIO_API_KEY: 'ak_test_platform_key',
            COMPOSIO_USER_ID: 'claws_user-1',
            COMPOSIO_CONNECTED_ACCOUNT_ID: 'ca_gmail_abc',
          },
          config: {
            composio: {
              toolkit: 'gmail',
              executeEndpoint: 'https://backend.composio.dev/api/v3/tools/execute',
            },
          },
        });
      });
    });

    it('emits one entry per compatible Skill (multi-skill fan-out)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            toolSlug: 'github',
            displayName: 'GitHub',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_github_xyz',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        // GitHub drives two skills. Fan-out is explicit in the contract: one
        // toolkit can power many distinct skills (e.g., issue triage + repo
        // reader). Each gets its own entry keyed by skill slug.
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { slug: 'github-issue-triage', compatibleTools: ['github'] },
          { slug: 'github-repo-reader', compatibleTools: ['github'] },
        ]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);

        expect(Object.keys(config.skills.entries)).toEqual(
          expect.arrayContaining(['github-issue-triage', 'github-repo-reader']),
        );
        expect(config.skills.entries['github-issue-triage'].config.composio.toolkit).toBe('github');
        expect(config.skills.entries['github-repo-reader'].config.composio.toolkit).toBe('github');
        // Both entries share the same connected account - they represent
        // different verbs against the same OAuth grant.
        expect(config.skills.entries['github-issue-triage'].env.COMPOSIO_CONNECTED_ACCOUNT_ID).toBe('ca_github_xyz');
        expect(config.skills.entries['github-repo-reader'].env.COMPOSIO_CONNECTED_ACCOUNT_ID).toBe('ca_github_xyz');
      });
    });

    it('uses the catalog composioToolkitId (not the catalog slug) - verifies slug-drift fixes land correctly', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        // `google_calendar` is our catalog slug; Composio's real toolkit slug
        // is `googlecalendar` (no underscore). The generator must emit the
        // Composio slug in config.composio.toolkit - not the catalog slug.
        ws.toolConnections = [
          {
            toolSlug: 'google_calendar',
            displayName: 'Google Calendar',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_gcal_123',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { slug: 'google-calendar', compatibleTools: ['google_calendar'] },
        ]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);

        expect(config.skills.entries['google-calendar'].config.composio.toolkit).toBe('googlecalendar');
      });
    });

    it('skips OAUTH_COMPOSIO rows with null composioConnectionId (OAuth initiated but not completed)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            toolSlug: 'hubspot',
            displayName: 'HubSpot',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: null,
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);
        expect(config.skills).toBeUndefined();
      });
    });

    it('skips OAUTH_COMPOSIO rows with status != CONNECTED (e.g., EXPIRED, REVOKED, PENDING)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            toolSlug: 'hubspot',
            displayName: 'HubSpot',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'EXPIRED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_hubspot_stale',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);
        expect(config.skills).toBeUndefined();
      });
    });

    it('skips OAUTH_COMPOSIO rows when the tool is not in the catalog (e.g., orphan after removal)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            // `buffer` was removed from the catalog in PR #4 Commit 1. Any
            // lingering ToolConnection row with this slug (from a prior seed
            // run) must NOT produce emission - the generator has no
            // composioToolkitId to work with.
            toolSlug: 'buffer',
            displayName: 'Buffer',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_buffer_stale',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);
        expect(config.skills).toBeUndefined();
      });
    });

    it('does not query prisma.skill.findMany when no emission-eligible tools are connected (saves the round-trip)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        // C-engine B1: the lookup widened from OAuth-only to ALL
        // emission-eligible connected tools (curated emission + uncurated
        // detection share it), so the canary condition is now "no eligible
        // connections at all" rather than "no OAuth connections".
        ws.toolConnections = [];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        // If the generator does call findMany despite no eligible
        // connections, this rejection surfaces as a failure - the canary.
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('prisma.skill.findMany should not be called when no emission-eligible tools are connected'),
        );

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);
        expect(config.skills).toBeUndefined();
      });
    });

    it('mixes API_KEY and OAUTH_COMPOSIO entries without collision', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        ws.toolConnections = [
          {
            toolSlug: 'tavily',
            displayName: 'Tavily',
            connectionType: 'API_KEY',
            status: 'CONNECTED',
            encryptedCredentials: JSON.stringify({ TAVILY_API_KEY: 'tvly-k' }),
            composioConnectionId: null,
            composioEntityId: null,
          },
          {
            toolSlug: 'gmail',
            displayName: 'Gmail',
            connectionType: 'OAUTH_COMPOSIO',
            status: 'CONNECTED',
            encryptedCredentials: null,
            composioConnectionId: 'ca_gmail_mix',
            composioEntityId: 'claws_user-1',
          },
        ];
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
          { slug: 'gmail-outreach', compatibleTools: ['gmail'] },
        ]);

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);

        // API_KEY: keyed by tool slug, env is the decrypted payload.
        expect(config.skills.entries.tavily).toEqual({
          enabled: true,
          env: { TAVILY_API_KEY: 'tvly-k' },
        });
        // OAUTH_COMPOSIO: keyed by skill slug, env is the Composio triple,
        // config carries the composio block.
        expect(config.skills.entries['gmail-outreach'].env.COMPOSIO_CONNECTED_ACCOUNT_ID).toBe('ca_gmail_mix');
        expect(config.skills.entries['gmail-outreach'].config.composio.toolkit).toBe('gmail');
      });
    });
  });

  describe('heartbeat integration (generator end-to-end)', () => {
    function withOrchestratorHeartbeat(frequency: string | null, time: string | null) {
      const ws = buildMockWorkspace();
      const orch = ws.agents.find((a) => a.role === 'ORCHESTRATOR')! as Record<string, unknown>;
      orch.heartbeatFrequency = frequency;
      orch.heartbeatTime = time;
      return ws;
    }

    it('hourly: writes cron job to cron/jobs.json and NO heartbeat interval in openclaw.json', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('hourly', null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);

      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs).toHaveLength(1);
      expect(cronJobs[0].schedule.expr).toBe('0 * * * *');
    });

    it('every_6h: writes 6h cron to cron/jobs.json', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('every_6h', null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs[0].schedule.expr).toBe('0 */6 * * *');
    });

    it('daily at 08:00: writes cron job to cron/jobs.json and NO heartbeat in openclaw.json', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('daily', '08:00')
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);

      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs).toHaveLength(1);
      const job = cronJobs[0];
      expect(job.schedule).toEqual({ kind: 'cron', expr: '0 8 * * *', tz: 'America/New_York' });
      // PR-2b #9: sessionTarget is now the session-keyed form for the
      // orchestrator's main session. "main" (the pre-PR-2b value) is
      // rejected at fire time by OpenClaw for agentTurn payloads, so
      // the heartbeat was silently no-firing. The mock orchestrator name
      // is "Test Commander" → toAgentId → "test-commander".
      expect(job.sessionTarget).toBe('session:agent:test-commander:main');
      expect(job.agentId).toBe('test-commander');
      // PR-2b #8: id is REQUIRED by OpenClaw's cron store load. Was missing
      // pre-PR-2b → every daily/weekday heartbeat was silently dropped.
      expect(typeof job.id).toBe('string');
      expect(String(job.id).length).toBeGreaterThan(0);
      expect(job.id).toContain('test-commander');
      expect(job.wakeMode).toBe('now');
      expect(job.payload.kind).toBe('agentTurn');
      expect(job.enabled).toBe(true);
    });

    it('weekday at 09:30: produces "30 9 * * 1-5" cron expression', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('weekday', '09:30')
      );
      const result = await generateWorkspace('ws-test-1');
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(cronJobs[0].schedule.expr).toBe('30 9 * * 1-5');
    });

    it('off: no heartbeat in openclaw.json and no cron job', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('off', null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs).toEqual([]);
    });

    it('null frequency + checklist-only MD: no heartbeat interval and no cron job', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat(null, null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs).toEqual([]);
    });

    it('MUTATION-anchored: null frequency + HEARTBEAT.md cron lines → jobs.json heartbeat', async () => {
      // Fixture shape (Twitter/X Growth Machine): schedule lives in MD only.
      // Dropping MD→jobs emission leaves cron/jobs.json=[] and deploy cols null.
      const ws = withOrchestratorHeartbeat(null, null);
      const orch = ws.agents.find((a) => a.role === 'ORCHESTRATOR')! as Record<string, unknown>;
      orch.heartbeatMd = `- cron: "0 8 * * *"
  task: daily_trend_scan
- cron: "0 12,16,20 * * *"
  task: content_cycle
- cron: "0 21 * * *"
  task: daily_analytics`;
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']) as Array<{
        id?: string
        name?: string
        schedule?: { kind?: string; expr?: string; tz?: string }
        sessionTarget?: string
        agentId?: string
      }>;

      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs.length).toBeGreaterThanOrEqual(3);
      const exprs = cronJobs.map((j) => j.schedule?.expr);
      expect(exprs).toContain('0 8 * * *');
      expect(exprs).toContain('0 12,16,20 * * *');
      expect(exprs).toContain('0 21 * * *');
      for (const job of cronJobs) {
        expect(typeof job.id).toBe('string');
        expect(String(job.id).length).toBeGreaterThan(0);
        expect(job.name).toMatch(/^orchestrator-heartbeat-/);
        expect(job.schedule?.kind).toBe('cron');
        expect(job.sessionTarget).toBe('session:agent:test-commander:main');
        expect(job.agentId).toBe('test-commander');
      }
      // HEARTBEAT.md stays prose (unchanged checklist), not emptied.
      const orchKey = Object.keys(result.workspaces).find((k) => k.includes('test-commander'));
      expect(result.workspaces[orchKey!]['HEARTBEAT.md']).toContain('cron: "0 8 * * *"');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // PR-2b #4: plugin entry emits hooks.allowConversationAccess so the
  // upstream sandbox doesn't block before_agent_run + agent_end (those
  // hooks are gated behind explicit opt-in for non-bundled plugins).
  // ─────────────────────────────────────────────────────────────────────
  describe('PR-2b #4: plugins.entries.claws-activity-reporter.hooks.allowConversationAccess', () => {
    it('emits hooks.allowConversationAccess: true on the activity-reporter entry', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildMockWorkspace()
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const entry = config.plugins?.entries?.['claws-activity-reporter'];
      expect(entry).toBeDefined();
      // Sanity: enabled is still set from PR-2.
      expect(entry.enabled).toBe(true);
      // PR-2b #4: the new opt-in. Without it, before_agent_run and
      // agent_end (TASK_START / TASK_COMPLETE / TASK_FAILED) are blocked
      // by the OpenClaw plugin sandbox.
      expect(entry.hooks?.allowConversationAccess).toBe(true);
    });

    it('plugins.load.paths still points at /opt/claws-activity-reporter', async () => {
      // Sanity that we didn't accidentally break the PR-2 load path.
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildMockWorkspace()
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      expect(config.plugins?.load?.paths).toEqual(['/opt/claws-activity-reporter']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // PR-3: enable the bundled `admin-http-rpc` plugin so the host-side
  // health-monitor cron can call POST /api/v1/admin/rpc on the gateway.
  // The plugin's configSchema is { properties: {}, additionalProperties:
  // false }, so the entry MUST be exactly { enabled: true } - anything
  // extra fails the openclaw.json strict() validation and the gateway
  // refuses to boot.
  // ─────────────────────────────────────────────────────────────────────
  describe('PR-3: plugins.entries.admin-http-rpc enabled (bundled, strict config)', () => {
    it('emits exactly { enabled: true } for admin-http-rpc (no extra fields)', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildMockWorkspace()
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const entry = config.plugins?.entries?.['admin-http-rpc'];
      expect(entry).toBeDefined();
      expect(entry).toEqual({ enabled: true });
    });

    it('does not break the existing claws-activity-reporter entry', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildMockWorkspace()
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const reporter = config.plugins?.entries?.['claws-activity-reporter'];
      expect(reporter).toBeDefined();
      expect(reporter.enabled).toBe(true);
      expect(reporter.hooks?.allowConversationAccess).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // PR-2b #10: scheduledTasks cron emit (currently dormant - no Prisma
  // column populated - but the code path exists and would emit the same
  // platform-wide bug shape if/when wired. Lock the correct shape now.)
  // ─────────────────────────────────────────────────────────────────────
  describe('PR-2b #10: scheduledTasks cron emit shape', () => {
    function withScheduledTasks(tasks: Array<Record<string, unknown>>) {
      const ws = buildMockWorkspace();
      (ws as Record<string, unknown>).scheduledTasks = tasks;
      return ws;
    }

    it('emits scheduled-task crons with id, agentId, and session-keyed sessionTarget for non-isolated tasks', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withScheduledTasks([
          { name: 'Daily Report', schedule: '0 9 * * *', timezone: 'UTC', isolated: false, urgent: false, prompt: 'Send the daily report.', fullContext: true },
        ])
      );
      const result = await generateWorkspace('ws-test-1');
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      // 1 heartbeat (hourly by default mock) is an INTERVAL, so cron/jobs.json
      // only has the scheduled-task cron. If the mock orchestrator's hourly
      // frequency ever changes to daily, this length may be 2.
      const taskJob = cronJobs.find((j: Record<string, unknown>) => j.name === 'Daily Report');
      expect(taskJob).toBeDefined();
      expect(typeof taskJob.id).toBe('string');
      expect(String(taskJob.id).length).toBeGreaterThan(0);
      expect(taskJob.id).toContain('daily-report');
      expect(taskJob.agentId).toBe('test-commander');
      expect(taskJob.sessionTarget).toBe('session:agent:test-commander:main');
      // NOT "main" (which would be rejected at fire time for agentTurn payloads).
      expect(taskJob.sessionTarget).not.toBe('main');
    });

    it('emits sessionTarget="isolated" for isolated scheduled tasks (valid for agentTurn)', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withScheduledTasks([
          { name: 'Background Analysis', schedule: '0 */6 * * *', timezone: 'UTC', isolated: true, urgent: false, prompt: 'Run background analysis.', fullContext: false },
        ])
      );
      const result = await generateWorkspace('ws-test-1');
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      const taskJob = cronJobs.find((j: Record<string, unknown>) => j.name === 'Background Analysis');
      expect(taskJob.sessionTarget).toBe('isolated');
      // Still has id + agentId regardless.
      expect(typeof taskJob.id).toBe('string');
      expect(taskJob.agentId).toBe('test-commander');
    });

    it('K3 deterministic pause: excludes paused Worker-targeted scheduled crons', async () => {
      const ws = withScheduledTasks([
        { name: 'Worker Followup', schedule: '0 9 * * *', timezone: 'UTC', agentSlug: 'data-analyst', isolated: false, urgent: false, prompt: 'Run worker followup.', fullContext: true },
      ]);
      ws.agents[1].isPaused = true;
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(cronJobs.find((j: Record<string, unknown>) => j.name === 'Worker Followup')).toBeUndefined();
    });

    it('scheduledTasks ids are deterministic across calls', async () => {
      const tasks = [{ name: 'My Task', schedule: '0 0 * * *', timezone: 'UTC', isolated: false, urgent: false, prompt: 'do it', fullContext: true }];
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(withScheduledTasks(tasks));
      const a = await generateWorkspace('ws-test-1');
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(withScheduledTasks(tasks));
      const b = await generateWorkspace('ws-test-1');
      const aJobs = JSON.parse(a['cron/jobs.json']);
      const bJobs = JSON.parse(b['cron/jobs.json']);
      expect(aJobs.find((j: Record<string, unknown>) => j.name === 'My Task').id).toBe(
        bJobs.find((j: Record<string, unknown>) => j.name === 'My Task').id,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3.2 credit metering: PLATFORM_CREDIT openclaw.json baseUrl + omit
  // user ANTHROPIC_API_KEY from .env. Mutations that drop emission or bake
  // the key back must fail these assertions.
  // Resolved mode = workspace.apiKeySourceOverride ?? user.apiKeySource.
  // ─────────────────────────────────────────────────────────────────────
  describe('3.2 PLATFORM_CREDIT: proxy baseUrl + omit BYOK ANTHROPIC_API_KEY', () => {
    // buildMockWorkspace spreads overrides before hardcoding `user`, so
    // mode fields must be patched onto the fixture after build.
    function creditWorkspace(opts: {
      override: 'PLATFORM_CREDIT' | null;
      userSource: 'NONE' | 'USER_OWN_KEY' | 'PLATFORM_CREDIT';
    }) {
      const ws = buildMockWorkspace({ apiKeySourceOverride: opts.override });
      (ws as { user: Record<string, unknown> }).user = {
        ...ws.user,
        apiKeySource: opts.userSource,
        apiKeys: [{ provider: 'ANTHROPIC', encryptedKey: 'encrypted-anthropic-key' }],
      };
      return ws;
    }

    it('credit-mode (workspace override): emits models.providers.anthropic.baseUrl and omits user ANTHROPIC_API_KEY from .env', async () => {
      // Mutation: drop baseUrl emission → fail. Mutation: bake user key → fail.
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        creditWorkspace({ override: 'PLATFORM_CREDIT', userSource: 'NONE' }),
      );

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']) as {
        models?: { providers?: { anthropic?: { baseUrl?: string } } };
      };

      expect(config.models?.providers?.anthropic?.baseUrl).toBe(ANTHROPIC_PROXY_URL);
      expect(ANTHROPIC_PROXY_URL).toBe('http://localhost:3789');
      expect(result['.env']).not.toContain('ANTHROPIC_API_KEY=');
      // Resolved-mode source: override drives PLATFORM_CREDIT despite user NONE.
      expect(result['.env']).toContain('OPENCLAW_GATEWAY_TOKEN=');
    });

    it('resolved-mode source: workspace override PLATFORM_CREDIT beats user USER_OWN_KEY', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        creditWorkspace({ override: 'PLATFORM_CREDIT', userSource: 'USER_OWN_KEY' }),
      );

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']) as {
        models?: { providers?: { anthropic?: { baseUrl?: string } } };
      };

      expect(config.models?.providers?.anthropic?.baseUrl).toBe('http://localhost:3789');
      expect(result['.env']).not.toContain('ANTHROPIC_API_KEY=');
    });

    it('BYOK workspace: no models.providers.anthropic.baseUrl and user ANTHROPIC_API_KEY present', async () => {
      // Regression both ways vs credit-mode assertions above.
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        creditWorkspace({ override: null, userSource: 'USER_OWN_KEY' }),
      );

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']) as {
        models?: { providers?: { anthropic?: { baseUrl?: string } } };
      };

      expect(config.models?.providers?.anthropic?.baseUrl).toBeUndefined();
      expect(config.models).toBeUndefined();
      expect(result['.env']).toContain('ANTHROPIC_API_KEY=decrypted-encrypted-anthropic-key');
    });

    it('NONE mode with stored key: no baseUrl, still emits user key (stale-BYOK path)', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        creditWorkspace({ override: null, userSource: 'NONE' }),
      );

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']) as {
        models?: { providers?: { anthropic?: { baseUrl?: string } } };
      };

      expect(config.models).toBeUndefined();
      expect(result['.env']).toContain('ANTHROPIC_API_KEY=decrypted-encrypted-anthropic-key');
    });
  });

  describe('OpenRouter BYOK emission', () => {
    it('emits OPENROUTER_API_KEY + models.providers.openrouter.baseUrl when agent uses openrouter/*', async () => {
      const ws = buildMockWorkspace();
      ws.agents[0].model = 'openrouter/openai/gpt-4o-mini';
      ;(ws as { user: Record<string, unknown> }).user = {
        ...ws.user,
        apiKeySource: 'USER_OWN_KEY',
        apiKeys: [
          { provider: 'ANTHROPIC', encryptedKey: 'encrypted-anthropic-key' },
          { provider: 'OPENROUTER', encryptedKey: 'encrypted-openrouter-key' },
        ],
      };
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);

      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']) as {
        agents: { list: Array<{ model?: string }> };
        models?: { providers?: { openrouter?: { baseUrl?: string; api?: string } } };
      };

      expect(config.agents.list.some((a) => a.model === 'openrouter/openai/gpt-4o-mini')).toBe(true);
      expect(config.models?.providers?.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
      expect(config.models?.providers?.openrouter?.api).toBe('openai-completions');
      expect(result['.env']).toContain('OPENROUTER_API_KEY=decrypted-encrypted-openrouter-key');
    });
  });
});
