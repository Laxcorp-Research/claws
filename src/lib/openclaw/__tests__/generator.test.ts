import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 4)}...`),
}));

vi.mock('@/lib/crypto', () => ({
  generateSecureToken: vi.fn(() => 'mock-gateway-token-abc123'),
}));

import { generateWorkspace } from '@/lib/openclaw/generator';

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
      {
        toolName: 'Tavily',
        connectionType: 'API_KEY',
        skillSlug: 'tavily-search',
        envVarMapping: { TAVILY_API_KEY: 'encrypted-tavily-key' },
        notes: null,
      },
    ],
    channelConnections: [],
    clawTemplate: { name: 'Test Template', slug: 'test-template' },
    user: {
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

  it('includes tool connection credentials in skills entries', async () => {
    const result = await generateWorkspace('ws-test-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.skills).toBeDefined();
    expect(config.skills.entries['tavily-search']).toBeDefined();
    expect(config.skills.entries['tavily-search'].enabled).toBe(true);
    expect(config.skills.entries['tavily-search'].env.TAVILY_API_KEY).toBe(
      'decrypted-encrypted-tavily-key'
    );
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
