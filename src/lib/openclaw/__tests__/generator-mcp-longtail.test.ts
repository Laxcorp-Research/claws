// generator-mcp-longtail.test.ts - C-engine B1 contract tests (regression armor).
//
// B1 test plan mapping:
//   (a) curated-only → NO mcp block, with MUTATION-VERIFY (adding an
//       uncurated slug to the same fixture makes the block appear - the
//       guard is the conditional, not dead code).
//   (b) uncurated OAuth + flag ON → exact url/transport/header shape.
//   (c) flag OFF + uncurated → NO block (kill-switch).
//   (d) workers + critic carry composio__* in tools.deny; Orchestrator does
//       not. (Merge-not-clobber is unit-locked in mcp-longtail.test.ts -
//       generator-built entries never carry a pre-existing tools policy.)
//   (e) TOOLS.md carries the anti-fabrication section iff MCP-enabled.
//   (f) session lifecycle at the generator level: reuse (no persist write),
//       toolkit/account drift → create + new id persisted, use() rejection → create fallback.
//       (Set-equality semantics are unit-locked in mcp-longtail.test.ts.)
//   (g) API_KEY uncurated rows → warned (naming B3) + excluded from the
//       Tool Router toolkit list.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn((val: string) => val),
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
  generateKeyHint: vi.fn((val: string) => `${val.slice(0, 4)}...`),
}));

vi.mock('@/lib/crypto', () => ({
  generateSecureToken: vi.fn(() => 'mock-gateway-token'),
}));

const mockSessionRetrieve = vi.fn();
const mockSessionCreate = vi.fn();
const mockToolkitsGet = vi.fn();
const mockAuthConfigsList = vi.fn();
const mockConnectedAccountsInitiate = vi.fn();
vi.mock('@composio/core', () => ({
  AuthScheme: {
    APIKey: (params: { api_key?: string }) => ({ __scheme: 'API_KEY' as const, api_key: params.api_key }),
    BearerToken: (params: { token: string }) => ({ __scheme: 'BEARER_TOKEN' as const, token: params.token }),
    Basic: (params: { username: string; password: string }) => ({
      __scheme: 'BASIC' as const,
      username: params.username,
      password: params.password,
    }),
  },
}));
vi.mock('@/lib/composio', () => ({
  getComposio: vi.fn(() => ({
    client: { toolRouter: { session: { retrieve: mockSessionRetrieve } } },
    toolRouter: { create: mockSessionCreate },
    toolkits: { get: mockToolkitsGet },
    authConfigs: { list: mockAuthConfigsList, create: vi.fn() },
    connectedAccounts: { initiate: mockConnectedAccountsInitiate },
  })),
  getComposioUserId: (id: string) => `claws_${id}`,
}));

import { generateWorkspace } from '@/lib/openclaw/generator';

function roster(config: { agents?: { list?: unknown; entries?: Record<string, Record<string, unknown>> } }) {
  expect(config.agents).not.toHaveProperty('list');
  return Object.entries(config.agents?.entries ?? {}).map(([id, e]) => ({ id, ...e }));
}

const PLATFORM_KEY = 'ak_test_platform_key';
const MCP_URL = 'https://backend.composio.dev/tool_router/trs_test123/mcp';

type TestToolConn = {
  toolSlug: string;
  displayName: string;
  connectionType: 'API_KEY' | 'OAUTH_COMPOSIO' | 'CHANNEL_NATIVE' | 'NO_AUTH';
  status: string;
  encryptedCredentials: string | null;
  composioConnectionId: string | null;
  composioEntityId: string | null;
};

/** OAuth-connected tool with a curated Skill row (paired with skillRows below). */
const CURATED_OAUTH_CONN: TestToolConn = {
  toolSlug: 'gmail',
  displayName: 'Gmail',
  connectionType: 'OAUTH_COMPOSIO',
  status: 'CONNECTED',
  encryptedCredentials: null,
  composioConnectionId: 'ca_gmail_abc',
  composioEntityId: 'claws_user-1',
};

/** OAuth-connected tool with NO Skill row and NO catalog entry (long-tail). */
const UNCURATED_OAUTH_CONN: TestToolConn = {
  toolSlug: 'zzz-longtail-crm',
  displayName: 'Longtail CRM',
  connectionType: 'OAUTH_COMPOSIO',
  status: 'CONNECTED',
  encryptedCredentials: null,
  composioConnectionId: 'ca_longtail_1',
  composioEntityId: 'claws_user-1',
};

const CURATED_SKILL_ROWS = [{ slug: 'gmail-outreach', compatibleTools: ['gmail'] }];

function buildMockWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-mcp-1',
    name: 'MCP Test Claw',
    slug: 'mcp-test-claw',
    status: 'DRAFT',
    userId: 'user-1',
    clawTemplateId: 'tpl-1',
    timezone: 'UTC',
    userContext: null,
    scheduledTasks: null,
    channelConfigEncrypted: null,
    containerHost: null,
    composioToolRouterSessionId: null,
    agents: [
      {
        id: 'agent-orch',
        name: 'Commander',
        role: 'ORCHESTRATOR',
        description: 'orchestrates',
        model: 'HAIKU_4_5',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8,
        emoji: null,
        skills: [],
        outgoingConnections: [],
        incomingConnections: [],
      },
      {
        id: 'agent-worker',
        name: 'Analyst',
        role: 'WORKER',
        description: 'works',
        model: 'HAIKU_4_5',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8,
        emoji: null,
        skills: [],
        outgoingConnections: [],
        incomingConnections: [],
      },
      {
        id: 'agent-critic',
        name: 'Reviewer',
        role: 'CRITIC',
        description: 'reviews',
        model: 'HAIKU_4_5',
        soulMd: '',
        agentsMd: '',
        heartbeatMd: '',
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8,
        emoji: null,
        skills: [],
        outgoingConnections: [],
        incomingConnections: [],
      },
    ],
    toolConnections: [] as TestToolConn[],
    channelConfig: {},
    clawTemplate: { name: 'MCP Template', slug: 'mcp-template' },
    user: { id: 'user-1', name: 'Test User', apiKeys: [] },
    ...overrides,
  };
}

function primeMocks(params: {
  toolConnections: TestToolConn[];
  skillRows?: Array<{ slug: string; compatibleTools: string[] }>;
  storedSessionId?: string | null;
}) {
  const ws = buildMockWorkspace({
    toolConnections: params.toolConnections.map((tc) => ({ ...tc })),
    composioToolRouterSessionId: params.storedSessionId ?? null,
  });
  (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(ws);
  (prismaMock.skill.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(params.skillRows ?? []);
  (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

const envSnapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  envSnapshot.flag = process.env.CLAWS_MCP_LONGTAIL_ENABLED;
  envSnapshot.key = process.env.COMPOSIO_API_KEY;
  process.env.CLAWS_MCP_LONGTAIL_ENABLED = 'true';
  process.env.COMPOSIO_API_KEY = PLATFORM_KEY;
  mockSessionRetrieve.mockReset();
  mockSessionCreate.mockReset();
  mockToolkitsGet.mockReset();
  mockAuthConfigsList.mockReset();
  mockConnectedAccountsInitiate.mockReset();
  mockSessionCreate.mockResolvedValue({ sessionId: 'trs_test123', mcp: { url: MCP_URL } });
  mockToolkitsGet.mockRejectedValue(new Error('toolkit not found'));
});

afterEach(() => {
  if (envSnapshot.flag === undefined) delete process.env.CLAWS_MCP_LONGTAIL_ENABLED;
  else process.env.CLAWS_MCP_LONGTAIL_ENABLED = envSnapshot.flag;
  if (envSnapshot.key === undefined) delete process.env.COMPOSIO_API_KEY;
  else process.env.COMPOSIO_API_KEY = envSnapshot.key;
});

describe('(a) curated-only workspaces get NO mcp block', () => {
  it('emits no mcp block and never touches the Tool Router for a fully-curated workspace', async () => {
    primeMocks({ toolConnections: [CURATED_OAUTH_CONN], skillRows: CURATED_SKILL_ROWS });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.mcp).toBeUndefined();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    // Sanity: the curated path still emitted its skills entry.
    expect(config.skills.entries['gmail-outreach']).toBeDefined();
  });

  it('MUTATION-VERIFY: the SAME fixture plus one uncurated slug makes the block appear', async () => {
    primeMocks({
      toolConnections: [CURATED_OAUTH_CONN, UNCURATED_OAUTH_CONN],
      skillRows: CURATED_SKILL_ROWS,
    });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    // The guard is the uncurated-detection conditional, not dead code.
    expect(config.mcp).toBeDefined();
    expect(mockSessionCreate).toHaveBeenCalledOnce();
    // Curated emission is unaffected by the uncurated sibling.
    expect(config.skills.entries['gmail-outreach']).toBeDefined();
  });
});

describe('(b) uncurated OAuth workspace + flag ON emits the exact block shape', () => {
  it('emits mcp.servers.composio with url/transport/x-api-key', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.mcp).toEqual({
      servers: {
        composio: {
          url: MCP_URL,
          transport: 'streamable-http',
          headers: { 'x-api-key': PLATFORM_KEY },
        },
      },
    });
  });

  it('maps uncurated slugs to toolkit ids with catalog passthrough (composioToolkitId ?? slug)', async () => {
    const catalogUncurated: TestToolConn = {
      // In the catalog with composioToolkitId 'googlecalendar' (slug drift),
      // but given NO Skill row here → uncurated.
      toolSlug: 'google_calendar',
      displayName: 'Google Calendar',
      connectionType: 'OAUTH_COMPOSIO',
      status: 'CONNECTED',
      encryptedCredentials: null,
      composioConnectionId: 'ca_gcal_1',
      composioEntityId: 'claws_user-1',
    };
    primeMocks({ toolConnections: [catalogUncurated, UNCURATED_OAUTH_CONN] });

    await generateWorkspace('ws-mcp-1');

    expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
      // Catalog slug maps through composioToolkitId; non-catalog slug
      // passes through unchanged (same doctrine as oauth/initiate).
      toolkits: { enable: ['googlecalendar', 'zzz-longtail-crm'] },
      connectedAccounts: {
        googlecalendar: 'ca_gcal_1',
        'zzz-longtail-crm': 'ca_longtail_1',
      },
      workbench: { enable: false },
      manageConnections: false,
    });
  });
});

describe('(c) kill-switch: flag OFF + uncurated present → NO block', () => {
  it('emits nothing and never calls the Tool Router when the flag is off', async () => {
    process.env.CLAWS_MCP_LONGTAIL_ENABLED = 'false';
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.mcp).toBeUndefined();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionRetrieve).not.toHaveBeenCalled();
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });
});

describe('(d) per-agent token-tax scoping', () => {
  it('workers + critic carry composio__* in tools.deny; Orchestrator does not', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    const orch = roster(config).find((a: Record<string, unknown>) => a.name === 'Commander');
    const worker = roster(config).find((a: Record<string, unknown>) => a.name === 'Analyst');
    const critic = roster(config).find((a: Record<string, unknown>) => a.name === 'Reviewer');

    expect(worker.tools.deny).toContain('composio__*');
    expect(critic.tools.deny).toContain('composio__*');
    expect(orch.tools.deny).not.toContain('composio__*');
    expect(orch.tools.deny).toEqual(expect.arrayContaining(['message', 'exec']));
  });

  it('emits no composio deny when the workspace is not MCP-enabled', async () => {
    primeMocks({ toolConnections: [CURATED_OAUTH_CONN], skillRows: CURATED_SKILL_ROWS });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    for (const agent of roster(config)) {
      expect(agent.tools.deny).toEqual(expect.arrayContaining(['message', 'exec']));
      expect(agent.tools.deny).not.toContain('composio__*');
    }
  });
});

describe('(e) TOOLS.md anti-fabrication section iff MCP-enabled', () => {
  it('appends the long-tail section to EVERY agent TOOLS.md when MCP-enabled', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');

    const keys = Object.keys(result.workspaces);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      const toolsMd = result.workspaces[key]['TOOLS.md'];
      expect(toolsMd).toContain('## Long-Tail Tools (composio__*)');
      expect(toolsMd).toContain('NEVER fabricate');
      expect(toolsMd).toContain('report the failure verbatim');
      expect(toolsMd).toContain('Claws platform');
      expect(toolsMd).toContain('Manage Tools');
      expect(toolsMd).not.toContain('OpenClaw');
      expect(toolsMd).not.toContain('localhost');
    }
  });

  it('omits the section for curated-only workspaces', async () => {
    primeMocks({ toolConnections: [CURATED_OAUTH_CONN], skillRows: CURATED_SKILL_ROWS });

    const result = await generateWorkspace('ws-mcp-1');

    for (const key of Object.keys(result.workspaces)) {
      expect(result.workspaces[key]['TOOLS.md']).not.toContain('Long-Tail Tools');
    }
  });

  it('omits the section when the flag is off even with uncurated tools', async () => {
    process.env.CLAWS_MCP_LONGTAIL_ENABLED = 'false';
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');

    for (const key of Object.keys(result.workspaces)) {
      expect(result.workspaces[key]['TOOLS.md']).not.toContain('Long-Tail Tools');
    }
  });
});

describe('(f) session lifecycle through the generator', () => {
  it('set-equal stored session → reused url, create NOT called, id NOT re-persisted', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN], storedSessionId: 'trs_stored' });
    mockSessionRetrieve.mockResolvedValue({
      session_id: 'trs_stored',
      mcp: { url: 'https://backend.composio.dev/tool_router/trs_stored/mcp' },
      config: {
        toolkits: { enabled: ['zzz-longtail-crm'] },
        connected_accounts: { 'zzz-longtail-crm': 'ca_longtail_1' },
      },
    });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(config.mcp.servers.composio.url).toBe(
      'https://backend.composio.dev/tool_router/trs_stored/mcp',
    );
    // Same id → no pointless write.
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ composioToolRouterSessionId: expect.anything() }),
      }),
    );
  });

  it('toolkit-set drift → create called and the NEW id persisted on Workspace', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN], storedSessionId: 'trs_stored' });
    mockSessionRetrieve.mockResolvedValue({
      session_id: 'trs_stored',
      mcp: { url: 'https://x/trs_stored/mcp' },
      config: {
        toolkits: { enabled: ['some-other-toolkit'] },
        connected_accounts: { 'some-other-toolkit': 'ca_other' },
      },
    });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(mockSessionCreate).toHaveBeenCalledOnce();
    expect(config.mcp.servers.composio.url).toBe(MCP_URL);
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-mcp-1' },
      data: { composioToolRouterSessionId: 'trs_test123' },
    });
  });

  it('account-id drift with same toolkit set → create called and the NEW id persisted', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN], storedSessionId: 'trs_stored' });
    mockSessionRetrieve.mockResolvedValue({
      session_id: 'trs_stored',
      mcp: { url: 'https://x/trs_stored/mcp' },
      config: {
        toolkits: { enabled: ['zzz-longtail-crm'] },
        connected_accounts: { 'zzz-longtail-crm': 'ca_old_connection' },
      },
    });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
      toolkits: { enable: ['zzz-longtail-crm'] },
      connectedAccounts: { 'zzz-longtail-crm': 'ca_longtail_1' },
      workbench: { enable: false },
      manageConnections: false,
    });
    expect(config.mcp.servers.composio.url).toBe(MCP_URL);
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-mcp-1' },
      data: { composioToolRouterSessionId: 'trs_test123' },
    });
  });

  it('retrieve rejection (dead session) → create fallback + new id persisted', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN], storedSessionId: 'trs_dead' });
    mockSessionRetrieve.mockRejectedValue(new Error('404 not found'));

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(mockSessionCreate).toHaveBeenCalledOnce();
    expect(config.mcp).toBeDefined();
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-mcp-1' },
      data: { composioToolRouterSessionId: 'trs_test123' },
    });
  });

  it('session-resolution failure is non-fatal: deploys WITHOUT the mcp block', async () => {
    primeMocks({ toolConnections: [UNCURATED_OAUTH_CONN] });
    mockSessionCreate.mockRejectedValue(new Error('composio down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await generateWorkspace('ws-mcp-1');
      const config = JSON.parse(result['openclaw.json']);

      expect(config.mcp).toBeUndefined();
      expect(warnSpy.mock.calls.flat().join('\n')).toContain('Tool Router session resolution failed');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('(g) API_KEY uncurated rows: warned + excluded from the toolkit list', () => {
  const UNCURATED_API_KEY_CONN: TestToolConn = {
    toolSlug: 'zzz-local-key-tool',
    displayName: 'Local Key Tool',
    connectionType: 'API_KEY',
    status: 'CONNECTED',
    encryptedCredentials: JSON.stringify({ ZZZ_API_KEY: 'local-secret' }),
    composioConnectionId: null,
    composioEntityId: null,
  };

  it('warns and does NOT include an unbackfilled API_KEY slug in the Tool Router toolkits', async () => {
    primeMocks({ toolConnections: [UNCURATED_API_KEY_CONN, UNCURATED_OAUTH_CONN] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await generateWorkspace('ws-mcp-1');

      const warnText = warnSpy.mock.calls.flat().join('\n');
      expect(warnText).toContain('zzz-local-key-tool');
      expect(warnText).toContain('lazy BYOK backfill failed');

      expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
        toolkits: { enable: ['zzz-longtail-crm'] }, // API_KEY slug excluded
        connectedAccounts: { 'zzz-longtail-crm': 'ca_longtail_1' },
        workbench: { enable: false },
        manageConnections: false,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('lazy-backfills a single-key uncurated API_KEY row, persists composioConnectionId, and includes it in enable+map', async () => {
    primeMocks({ toolConnections: [UNCURATED_API_KEY_CONN] });
    mockToolkitsGet.mockResolvedValue({
      slug: 'zzz-local-key-tool',
      name: 'Local Key Tool',
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: 'API_KEY' }],
    });
    mockAuthConfigsList.mockResolvedValue({
      items: [{ id: 'ac_local_key', isComposioManaged: false, authScheme: 'API_KEY' }],
    });
    mockConnectedAccountsInitiate.mockResolvedValue({ id: 'ca_backfilled_local', status: 'ACTIVE' });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith({
      where: { workspaceId_toolSlug: { workspaceId: 'ws-mcp-1', toolSlug: 'zzz-local-key-tool' } },
      data: expect.objectContaining({
        connectionType: 'OAUTH_COMPOSIO',
        encryptedCredentials: null,
        composioConnectionId: 'ca_backfilled_local',
        composioEntityId: 'claws_user-1',
        status: 'CONNECTED',
      }),
    });
    expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
      toolkits: { enable: ['zzz-local-key-tool'] },
      connectedAccounts: { 'zzz-local-key-tool': 'ca_backfilled_local' },
      workbench: { enable: false },
      manageConnections: false,
    });
    expect(config.mcp).toBeDefined();
  });

  it('lazy-backfill failure for multi-field local rows warns + excludes while deploy generation completes', async () => {
    const multiField: TestToolConn = {
      ...UNCURATED_API_KEY_CONN,
      encryptedCredentials: JSON.stringify({ A_KEY: 'one', A_SECRET: 'two' }),
    };
    primeMocks({ toolConnections: [multiField] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await generateWorkspace('ws-mcp-1');
      const config = JSON.parse(result['openclaw.json']);

      expect(config.mcp).toBeUndefined();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls.flat().join('\n')).toContain('single-key rows only');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('API_KEY-only uncurated workspace gets NO mcp block (nothing Router-executable)', async () => {
    primeMocks({ toolConnections: [UNCURATED_API_KEY_CONN] });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(config.mcp).toBeUndefined();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    // The env entry itself still emits (existing API_KEY behavior).
    expect(config.skills.entries['zzz-local-key-tool']).toBeDefined();
  });

  it('uncurated OAuth row missing composioConnectionId is warned + omitted from enable and map', async () => {
    const missingAccount: TestToolConn = {
      ...UNCURATED_OAUTH_CONN,
      toolSlug: 'zzz-missing-account',
      composioConnectionId: null,
    };
    primeMocks({ toolConnections: [missingAccount, UNCURATED_OAUTH_CONN] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await generateWorkspace('ws-mcp-1');

      const warnText = warnSpy.mock.calls.flat().join('\n');
      expect(warnText).toContain('zzz-missing-account');
      expect(warnText).toContain('no composioConnectionId');
      expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
        toolkits: { enable: ['zzz-longtail-crm'] },
        connectedAccounts: { 'zzz-longtail-crm': 'ca_longtail_1' },
        workbench: { enable: false },
        manageConnections: false,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('(h) no_auth accountless rows: enabled without connected account', () => {
  const NO_AUTH_CONN: TestToolConn = {
    toolSlug: 'hackernews',
    displayName: 'Hacker News',
    connectionType: 'NO_AUTH',
    status: 'CONNECTED',
    encryptedCredentials: null,
    composioConnectionId: null,
    composioEntityId: null,
  };

  it('includes no_auth toolkit in enable and omits it from connectedAccounts', async () => {
    primeMocks({ toolConnections: [NO_AUTH_CONN] });

    const result = await generateWorkspace('ws-mcp-1');
    const config = JSON.parse(result['openclaw.json']);

    expect(mockSessionCreate).toHaveBeenCalledWith('claws_user-1', {
      toolkits: { enable: ['hackernews'] },
      connectedAccounts: {},
      workbench: { enable: false },
      manageConnections: false,
    });
    expect(config.mcp).toBeDefined();
  });
});
