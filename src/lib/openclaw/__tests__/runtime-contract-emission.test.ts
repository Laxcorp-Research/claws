// Version-keyed emission contract tests (RUNTIME-9.4 soak containment).
//
// KEEP (5) P0, 2026-09-13: staging's generator emitted the 9.4 config shape
// unconditionally, so every wake of the 5.22-18 KEEP canary boot-looped on
// "Gateway failed to start: Invalid config ... agents.defaults: Invalid
// input". These tests generate BOTH shapes from the SAME workspace and
// validate each against a strict Zod mirror of the respective gateway
// schema.
//
// MUTATION LOCK: if the generator is ever reverted to unconditional-9.4
// emission, the 5.22 strict parse below fails (ownership / entries /
// systemAgent / trustedProxies are unknown keys to 5.22) - exactly the
// KEEP boot failure, caught at unit time instead of at wake time.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/encryption', () => ({
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

vi.mock('@/lib/tools/reprobe-on-deploy', () => ({
  reprobeWorkspaceToolConnections: vi.fn().mockResolvedValue({
    probed: 0,
    connected: 0,
    errors: 0,
    unverified: 0,
    skipped: 0,
  }),
}));

import { generateWorkspace } from '@/lib/openclaw/generator';

/** Same trimmed fixture family as generator.test.ts: orchestrator + worker + critic. */
function buildMockWorkspace() {
  return {
    id: 'ws-contract-1',
    name: 'Contract Claw',
    slug: 'contract-claw',
    status: 'DRAFT',
    userId: 'user-1',
    clawTemplateId: 'tpl-1',
    timezone: 'UTC',
    userContext: null,
    scheduledTasks: null,
    description: null,
    gatewayToken: null,
    hostPort: null,
    containerName: null,
    containerHost: null,
    apiKeySourceOverride: null,
    apiKeyOverrides: [] as { provider: string; encryptedKey: string }[],
    channelConfigEncrypted: null,
    seedFiles: null,
    deliveryMode: 'APPROVAL_REQUIRED',
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [
      {
        id: 'agent-orch',
        name: 'Test Commander',
        role: 'ORCHESTRATOR',
        description: 'The orchestrator',
        model: 'HAIKU_4_5',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '- [ ] Check status',
        heartbeatFrequency: 'hourly',
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        isPaused: false,
        reportsTo: null,
        thinkingDefault: null,
        workspaceId: 'ws-contract-1',
        skills: [],
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
        soulMd: '# Data Analyst',
        agentsMd: '# Procedures',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8.0,
        emoji: null,
        isPaused: false,
        reportsTo: 'agent-orch',
        thinkingDefault: null,
        workspaceId: 'ws-contract-1',
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
        thinkingDefault: null,
        workspaceId: 'ws-contract-1',
        skills: [],
        outgoingConnections: [],
        incomingConnections: [{ sourceAgent: { name: 'Test Commander' } }],
      },
    ],
    toolConnections: [],
    customToolConnections: [],
    channelConfig: {},
    clawTemplate: { name: 'Test Template', slug: 'test-template' },
    user: {
      id: 'user-1',
      name: 'Test User',
      apiKeySource: 'USER_OWN_KEY',
      apiKeys: [{ provider: 'ANTHROPIC', encryptedKey: 'encrypted-anthropic-key' }],
    },
  };
}

// ─── Strict Zod mirrors of the two gateway config contracts ────────────────
// Every object is .strict() - unknown keys FAIL, exactly like the runtime
// ("Invalid config"). The 5.22 mirror rejects the four 9.4-only surfaces;
// the 9.4 mirror requires them and rejects agents.list / default:true.

const AGENT_ID_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/i;

const toolsPolicy = z
  .object({
    deny: z.array(z.string()).optional(),
    allow: z.array(z.string()).optional(),
  })
  .strict();

const sharedEntryFields = {
  name: z.string(),
  workspace: z.string().regex(/^\/home\/node\/\.openclaw\/workspace-/),
  model: z.string(),
  thinkingDefault: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
  subagents: z
    .object({
      allowAgents: z.array(z.string()),
      requireAgentId: z.boolean(),
    })
    .strict()
    .optional(),
  skills: z.array(z.string()).optional(),
  tools: toolsPolicy.optional(),
};

const gatewayShared = {
  mode: z.literal('local'),
  bind: z.literal('lan'),
  port: z.literal(18789),
  controlUi: z.object({ allowedOrigins: z.array(z.string()) }).strict(),
};

const defaultsShared = {
  model: z.string(),
  heartbeat: z.unknown().optional(),
  subagents: z
    .object({
      maxChildrenPerAgent: z.number().int().min(5),
      maxSpawnDepth: z.literal(2),
    })
    .strict(),
};

const topLevelOptional = {
  channels: z.unknown().optional(),
  skills: z.unknown().optional(),
  plugins: z.unknown().optional(),
  tools: z.unknown().optional(),
  mcp: z.unknown().optional(),
};

/** 5.22 gateway mirror: agents.list roster; NO trustedProxies / ownership / systemAgent / entries. */
const config522 = z
  .object({
    gateway: z.object(gatewayShared).strict(),
    agents: z
      .object({
        defaults: z.object(defaultsShared).strict(),
        list: z
          .array(
            z
              .object({
                id: z.string().regex(AGENT_ID_RE),
                default: z.boolean().optional(),
                ...sharedEntryFields,
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    ...topLevelOptional,
  })
  .strict();

/** 9.4 gateway mirror: keyed agents.entries + ownership + systemAgent + trustedProxies; NO list / default / inner id. */
const config94 = z
  .object({
    gateway: z
      .object({
        ...gatewayShared,
        trustedProxies: z.array(z.string().regex(/^\d+\.\d+\.\d+\.\d+\/\d+$/)).min(1),
      })
      .strict(),
    agents: z
      .object({
        ownership: z.literal('explicit'),
        defaults: z
          .object({
            ...defaultsShared,
            systemAgent: z.object({ agentId: z.string().regex(AGENT_ID_RE) }).strict(),
          })
          .strict(),
        entries: z.record(z.string().regex(AGENT_ID_RE), z.object(sharedEntryFields).strict()),
      })
      .strict(),
    ...topLevelOptional,
  })
  .strict();

describe('version-keyed emission (same workspace, both contracts)', () => {
  it('null contract throws RUNTIME_CONTRACT_UNKNOWN and does not pick a branch', async () => {
    await expect(
      generateWorkspace('ws-contract-1', { runtimeContract: null }),
    ).rejects.toThrow('RUNTIME_CONTRACT_UNKNOWN');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace(),
    );
    (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('5.22 contract: agents.list + orchestrator default:true, strict-valid against the 5.22 mirror (KEEP 5.22-18 wake Invalid-config regression; unconditional-9.4 restored → THIS fails)', async () => {
    const result = await generateWorkspace('ws-contract-1', { runtimeContract: '5.22' });
    const config = JSON.parse(result['openclaw.json']);

    const parsed = config522.safeParse(config);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);

    // The four 9.4-only surfaces MUST be absent (5.22 strict Zod rejects them
    // with "Invalid config ... agents.defaults: Invalid input" at boot).
    expect(config.gateway).not.toHaveProperty('trustedProxies');
    expect(config.agents).not.toHaveProperty('ownership');
    expect(config.agents).not.toHaveProperty('entries');
    expect(config.agents.defaults).not.toHaveProperty('systemAgent');

    // 5.22 routing mechanism: orchestrator carries default:true in the list.
    const list = config.agents.list as Array<{ id: string; default?: boolean }>;
    expect(list.map((a) => a.id)).toEqual(['test-commander', 'data-analyst', 'quality-reviewer']);
    expect(list.find((a) => a.id === 'test-commander')?.default).toBe(true);
    expect(list.filter((a) => a.default === true)).toHaveLength(1);

    expect(result.runtimeContract).toBe('5.22');
  });

  it('9.4 contract: agents.entries + ownership explicit + systemAgent + trustedProxies, strict-valid against the 9.4 mirror (no list, no default:true)', async () => {
    const result = await generateWorkspace('ws-contract-1', { runtimeContract: '9.4' });
    const config = JSON.parse(result['openclaw.json']);

    const parsed = config94.safeParse(config);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);

    expect(config.agents).not.toHaveProperty('list');
    expect(JSON.stringify(config)).not.toMatch(/"default"\s*:\s*true/);
    expect(config.agents.defaults.systemAgent.agentId).toBe('test-commander');
    expect(Object.keys(config.agents.entries)).toEqual([
      'test-commander',
      'data-analyst',
      'quality-reviewer',
    ]);

    expect(result.runtimeContract).toBe('9.4');
  });

  it('OPENCLAW_CONFIG_READONLY=1 lands in .env for 9.4 only (5.22 runtime has no such knob)', async () => {
    const on94 = await generateWorkspace('ws-contract-1', { runtimeContract: '9.4' });
    expect(on94['.env']).toMatch(/^OPENCLAW_CONFIG_READONLY=1$/m);

    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace(),
    );
    const on522 = await generateWorkspace('ws-contract-1', { runtimeContract: '5.22' });
    expect(on522['.env']).not.toMatch(/OPENCLAW_CONFIG_READONLY/);
  });

  it('cron/jobs.json is byte-identical across contracts (R16 canonical hand-off is version-neutral)', async () => {
    const on94 = await generateWorkspace('ws-contract-1', { runtimeContract: '9.4' });
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildMockWorkspace(),
    );
    const on522 = await generateWorkspace('ws-contract-1', { runtimeContract: '5.22' });
    expect(on522['cron/jobs.json']).toBe(on94['cron/jobs.json']);
  });
});
