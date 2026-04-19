import { describe, it, expect, beforeEach, vi } from 'vitest';
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
          { targetAgent: { name: 'Data Analyst' }, condition: 'ON_COMPLETE' },
          { targetAgent: { name: 'Quality Reviewer' }, condition: 'ON_COMPLETE' },
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
      // unchanged — the generator then parses it and emits it as the
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
    channelConnections: [],
    clawTemplate: { name: 'Test Template', slug: 'test-template' },
    user: {
      id: 'user-1',
      name: 'Test User',
      apiKeys: [
        { provider: 'ANTHROPIC', encryptedKey: 'encrypted-anthropic-key' },
      ],
    },
  };
}

describe('generateWorkspace', () => {
  beforeEach(() => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace()
    );
  });

  it('returns a GeneratedWorkspace with all required keys', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result).toHaveProperty('openclaw.json');
    expect(result).toHaveProperty('.env');
    expect(result).toHaveProperty('workspaces');
    expect(result).toHaveProperty('cron/jobs.json');
    expect(result).toHaveProperty('gatewayToken');
  });

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

  it('generates a gateway token', async () => {
    const result = await generateWorkspace('ws-test-1');

    expect(result.gatewayToken).toBe('mock-gateway-token-abc123');
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
        // Both entries share the same connected account — they represent
        // different verbs against the same OAuth grant.
        expect(config.skills.entries['github-issue-triage'].env.COMPOSIO_CONNECTED_ACCOUNT_ID).toBe('ca_github_xyz');
        expect(config.skills.entries['github-repo-reader'].env.COMPOSIO_CONNECTED_ACCOUNT_ID).toBe('ca_github_xyz');
      });
    });

    it('uses the catalog composioToolkitId (not the catalog slug) — verifies slug-drift fixes land correctly', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        // `google_calendar` is our catalog slug; Composio's real toolkit slug
        // is `googlecalendar` (no underscore). The generator must emit the
        // Composio slug in config.composio.toolkit — not the catalog slug.
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
            // run) must NOT produce emission — the generator has no
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

    it('does not query prisma.skill.findMany when no OAuth tools are connected (saves the round-trip)', async () => {
      await withComposioEnv(async () => {
        const ws = buildMockWorkspace();
        // Default fixture has one API_KEY row (tavily) only. No OAuth rows.
        (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
        // If the generator does call findMany despite no OAuth connections,
        // this rejection would surface as a failure — the guard-rail canary.
        (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('prisma.skill.findMany should not be called when no OAUTH_COMPOSIO rows are CONNECTED'),
        );

        const result = await generateWorkspace('ws-test-1');
        const config = JSON.parse(result['openclaw.json']);
        // API_KEY emission still works; OAuth branch was short-circuited.
        expect(config.skills.entries.tavily).toBeDefined();
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

    it('hourly: writes interval to openclaw.json and no cron job', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('hourly', null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);

      expect(config.agents.defaults.heartbeat).toEqual({ every: '1h' });
      expect(cronJobs).toEqual([]);
    });

    it('every_6h: writes 6h interval to openclaw.json', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat('every_6h', null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      expect(config.agents.defaults.heartbeat).toEqual({ every: '6h' });
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
      expect(job.sessionTarget).toBe('main');
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

    it('null frequency: no heartbeat in openclaw.json and no cron job', async () => {
      (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
        withOrchestratorHeartbeat(null, null)
      );
      const result = await generateWorkspace('ws-test-1');
      const config = JSON.parse(result['openclaw.json']);
      const cronJobs = JSON.parse(result['cron/jobs.json']);
      expect(config.agents.defaults.heartbeat).toBeUndefined();
      expect(cronJobs).toEqual([]);
    });
  });
});
