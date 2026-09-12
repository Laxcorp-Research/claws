import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { CONFIG_FINGERPRINT_VERSION, buildWorkspaceConfigFingerprint } from '@/lib/openclaw/config-fingerprint';

function baseWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    name: 'Sales Claw',
    timezone: 'UTC',
    userContext: 'Prefers concise updates.',
    clawTemplateId: 'tpl-1',
    channelConfigEncrypted: 'enc-channel-v1',
    gatewayToken: 'enc-gateway-token',
    composioToolRouterSessionId: 'trs-original',
    mcpSessionHealthStatus: null,
    mcpSessionCheckedAt: null,
    mcpSessionLastError: null,
    activitySilenceDetectedAt: null,
    stateSyncStaleDetectedAt: null,
    lastHealthCheck: new Date('2026-01-01T00:00:00Z'),
    lastEnvReconcileAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'HEALTHY',
    containerId: 'svc-1',
    containerHost: 'example.railway.app',
    clawTemplate: { id: 'tpl-1' },
    user: {
      id: 'user-1',
      name: 'Ada',
      apiKeys: [
        { provider: 'ANTHROPIC', encryptedKey: 'enc-user-key-v1' },
      ],
    },
    agents: [
      {
        id: 'agent-orch',
        name: 'Commander',
        role: 'ORCHESTRATOR',
        description: 'Coordinates the team',
        model: 'anthropic/claude-sonnet-4-6',
        soulMd: '# Soul',
        agentsMd: '# Agents',
        heartbeatMd: '- [ ] Check pipeline',
        heartbeatFrequency: 'daily',
        heartbeatTime: '08:00',
        qualityThreshold: 8,
        reportsTo: null,
        positionX: 10,
        positionY: 20,
        isPaused: false,
        lastActiveAt: new Date('2026-01-01T00:00:00Z'),
        skills: [
          {
            skillId: 'skill-1',
            skill: {
              slug: 'gmail-outreach',
              name: 'Gmail Outreach',
              description: 'Send mail',
              emoji: null,
              requiredBins: [],
              compatibleTools: ['gmail'],
              skillMd: '# Gmail',
            },
          },
        ],
      },
      {
        id: 'agent-worker',
        name: 'Researcher',
        role: 'WORKER',
        description: 'Researches leads',
        model: 'anthropic/claude-haiku-4-5-20251001',
        soulMd: '# Researcher',
        agentsMd: '# Research steps',
        heartbeatMd: null,
        heartbeatFrequency: null,
        heartbeatTime: null,
        qualityThreshold: 8,
        reportsTo: 'agent-orch',
        positionX: 30,
        positionY: 40,
        isPaused: false,
        lastActiveAt: null,
        skills: [],
      },
    ],
    connections: [
      { sourceAgentId: 'agent-orch', targetAgentId: 'agent-worker', condition: 'ON_COMPLETE' },
    ],
    toolConnections: [
      {
        toolSlug: 'gmail',
        displayName: 'Gmail',
        connectionType: 'OAUTH_COMPOSIO',
        status: 'CONNECTED',
        encryptedCredentials: null,
        composioConnectionId: 'ca_gmail_v1',
        lastConnectionCheckAt: null,
        lastConnectionCheckResult: null,
      },
    ],
    customToolConnections: [],
    ...overrides,
  };
}

async function fingerprintFor(workspace: Record<string, unknown>) {
  (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspace);
  return buildWorkspaceConfigFingerprint('ws-1');
}

describe('buildWorkspaceConfigFingerprint', () => {
  beforeEach(() => {
    (prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(baseWorkspace());
  });

  it('golden hash tripwire: projection changes require a fingerprint version bump and golden update', async () => {
    // Contract: this hash is the committed output for the fixed fixture above.
    // If a field is added/removed from the fingerprint projection without a
    // deliberate CONFIG_FINGERPRINT_VERSION bump and golden update, this test
    // fails and blocks a fleet-wide cry-wolf drift banner.
    const fingerprint = await fingerprintFor(baseWorkspace());

    expect(CONFIG_FINGERPRINT_VERSION).toBe(4);
    expect(fingerprint.version).toBe(CONFIG_FINGERPRINT_VERSION);
    expect(fingerprint.versionFingerprints[1]?.hash).toBe('c012ea41abadfd5e4d64e06445613db358988f8c2ed471a1b1e71155fd3ee0c7');
    expect(fingerprint.versionFingerprints[2]?.hash).toBe('426dc9ac6591a231a0be32d130606dc4491ed2cd89657587648d1f1335749ef3');
    expect(fingerprint.versionFingerprints[3]?.hash).toBe('58b933ff08fc5ad3d5e9829b5753003fa72f9c37b83eebcdc2621c10aea5ff0c');
    expect(fingerprint.versionFingerprints[4]?.hash).toBe('b3ebc9dc87da8f1fae1de09b92366a45cfdc1b3e7e11db2c7fa434320faad22e');
    expect(fingerprint.hash).toBe('b3ebc9dc87da8f1fae1de09b92366a45cfdc1b3e7e11db2c7fa434320faad22e');
  });

  it('tool connect/disconnect changes the hash (mutation guard: dropping toolConnections from inputs fails)', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      toolConnections: [
        ...baseWorkspace().toolConnections,
        {
          toolSlug: 'google-docs',
          displayName: 'Google Docs',
          connectionType: 'OAUTH_COMPOSIO',
          status: 'CONNECTED',
          encryptedCredentials: null,
          composioConnectionId: 'ca_docs_v1',
        },
      ],
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('adding a no_auth tool connection changes the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      toolConnections: [
        ...baseWorkspace().toolConnections,
        {
          toolSlug: 'hackernews',
          displayName: 'Hacker News',
          connectionType: 'OAUTH_COMPOSIO',
          status: 'CONNECTED',
          encryptedCredentials: null,
          composioConnectionId: null,
        },
      ],
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('credential update changes the hash without decrypting credentials', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    (next.toolConnections[0] as { encryptedCredentials: string | null }).encryptedCredentials = 'enc-tool-key-v2';
    const after = await fingerprintFor(next);

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('custom API connect changes the tools hash (mutation guard: dropping customToolConnections from inputs fails)', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      customToolConnections: [
        {
          id: 'cust_crm_1',
          name: 'Internal CRM',
          baseUrl: 'https://crm.example.com/v1',
          authType: 'API_KEY_HEADER',
          encryptedCredentials: 'enc-custom-crm-v1',
          description: 'Lookup customer renewals.',
        },
      ],
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('custom API credential update changes the tools hash without decrypting the credential', async () => {
    const before = await fingerprintFor(baseWorkspace({
      customToolConnections: [
        {
          id: 'cust_crm_1',
          name: 'Internal CRM',
          baseUrl: 'https://crm.example.com/v1',
          authType: 'API_KEY_HEADER',
          encryptedCredentials: 'enc-custom-crm-v1',
          description: 'Lookup customer renewals.',
        },
      ],
    }));
    const after = await fingerprintFor(baseWorkspace({
      customToolConnections: [
        {
          id: 'cust_crm_1',
          name: 'Internal CRM',
          baseUrl: 'https://crm.example.com/v1',
          authType: 'API_KEY_HEADER',
          encryptedCredentials: 'enc-custom-crm-v2',
          description: 'Lookup customer renewals.',
        },
      ],
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('channel connect/disconnect changes the channels hash without decrypting channel secrets', async () => {
    const before = await fingerprintFor(baseWorkspace({ channelConfigEncrypted: null }));
    const after = await fingerprintFor(baseWorkspace({
      channelConfigEncrypted: 'enc:{"telegram":{"botToken":"123456789:secret"}}',
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.channels).not.toBe(before.areas.channels);
    expect(after.areas.tools).toBe(before.areas.tools);
  });

  it('channel allowFrom updates change only the channels hash', async () => {
    const before = await fingerprintFor(baseWorkspace({
      channelConfigEncrypted: 'enc:{"telegram":{"botToken":"123456789:secret"}}',
    }));
    const after = await fingerprintFor(baseWorkspace({
      channelConfigEncrypted: 'enc:{"telegram":{"botToken":"123456789:secret","allowFrom":["424242"]}}',
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.channels).not.toBe(before.areas.channels);
    expect(after.areas.tools).toBe(before.areas.tools);
  });

  it('agent model, SOUL.md, and skill changes change the agents area hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    next.agents[0].model = 'anthropic/claude-opus-4-6';
    next.agents[0].soulMd = '# New soul';
    next.agents[0].skills = [];
    const after = await fingerprintFor(next);

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.agents).not.toBe(before.areas.agents);
  });

  it('agent connection changes change the connections area hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    next.connections[0].condition = 'ON_APPROVAL';
    const after = await fingerprintFor(next);

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.connections).not.toBe(before.areas.connections);
  });

  it('contextNote changes the v4 connections hash (WIRE-FULL)', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      connections: [
        {
          sourceAgentId: 'agent-orch',
          targetAgentId: 'agent-worker',
          condition: 'ON_COMPLETE',
          contextNote: 'deep dives only',
        },
      ],
    }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.connections).not.toBe(before.areas.connections);
    // v3 projection ignores contextNote - stays comparable for redeploy banner.
    expect(after.versionFingerprints[3]?.areas.connections).toBe(
      before.versionFingerprints[3]?.areas.connections,
    );
  });

  it('choreography knobs change the v4 workspace hash (WIRE-FULL)', async () => {
    const before = await fingerprintFor(baseWorkspace({ maxRevisionRounds: 3, deliveryMode: 'APPROVAL_REQUIRED' }));
    const after = await fingerprintFor(baseWorkspace({ maxRevisionRounds: 5, deliveryMode: 'APPROVAL_REQUIRED' }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.workspace).not.toBe(before.areas.workspace);
    expect(after.versionFingerprints[3]?.areas.workspace).toBe(
      before.versionFingerprints[3]?.areas.workspace,
    );
  });

  it('timezone changes change the workspace area hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({ timezone: 'America/New_York' }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.workspace).not.toBe(before.areas.workspace);
  });

  it('cosmetic position, health, and timestamp fields do not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace({
      healthStatus: 'UNHEALTHY',
      lastHealthCheck: new Date('2026-02-01T00:00:00Z'),
      lastEnvReconcileAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });
    next.agents[0].positionX = 999;
    next.agents[0].positionY = 999;
    next.agents[0].lastActiveAt = new Date('2026-02-01T00:00:00Z');
    const after = await fingerprintFor(next);

    expect(after.hash).toBe(before.hash);
  });

  it('agent pause changes the v3 agents hash while v2 stays comparable (FP1.1 limitation)', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    next.agents[1].isPaused = true;
    const after = await fingerprintFor(next);

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.agents).not.toBe(before.areas.agents);
    // v2 deliberately excludes pause. A workspace deployed with a v2 stored
    // fingerprint will not banner on a pause-only change until it is rebaselined
    // by redeploying on v3.
    expect(after.versionFingerprints[2]?.hash).toBe(before.versionFingerprints[2]?.hash);
  });

  it('changing only composioToolRouterSessionId does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({ composioToolRouterSessionId: 'trs-recreated' }));

    expect(after.hash).toBe(before.hash);
  });

  it('changing only MCP session health metadata does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      mcpSessionHealthStatus: 'DEAD',
      mcpSessionCheckedAt: new Date('2026-07-04T21:20:00Z'),
      mcpSessionLastError: 'retrieve returned 404',
    }));

    expect(after.hash).toBe(before.hash);
  });

  it('changing only activity silence metadata does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      activitySilenceDetectedAt: new Date('2026-07-05T08:30:00Z'),
    }));

    expect(after.hash).toBe(before.hash);
  });

  it('changing only state-sync stale metadata does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({
      stateSyncStaleDetectedAt: new Date('2026-07-05T08:30:00Z'),
    }));

    expect(after.hash).toBe(before.hash);
  });

  // PR-C #10: alwaysOn is a dashboard-only hibernation-sweep opt-out. It must
  // NEVER enter the fingerprint - it does not change anything the generator
  // writes into the deployed container, so flipping it must not trigger a
  // config-drift banner or redeploy prompt.
  it('changing only alwaysOn does not change the hash (fingerprint exclusion, PR-C #10)', async () => {
    const before = await fingerprintFor(baseWorkspace({ alwaysOn: false }));
    const after = await fingerprintFor(baseWorkspace({ alwaysOn: true }));

    expect(after.hash).toBe(before.hash);
    expect(after.areas).toEqual(before.areas);
  });

  it("MUTATION: alwaysOn must not appear in any fingerprint area projection", async () => {
    const fingerprint = await fingerprintFor(baseWorkspace({ alwaysOn: true }));
    const serializedAreas = JSON.stringify(fingerprint.areas);
    expect(serializedAreas).not.toContain('alwaysOn');
  });

  it("changing only candidateRuntimeSoak does not change the hash (fingerprint exclusion, RUNTIME-9.4 PR-2)", async () => {
    const before = await fingerprintFor(baseWorkspace({ candidateRuntimeSoak: false }));
    const after = await fingerprintFor(baseWorkspace({ candidateRuntimeSoak: true }));

    expect(after.hash).toBe(before.hash);
    expect(after.areas).toEqual(before.areas);
  });

  it("MUTATION: candidateRuntimeSoak must not appear in any fingerprint area projection", async () => {
    const fingerprint = await fingerprintFor(baseWorkspace({ candidateRuntimeSoak: true }));
    const serializedAreas = JSON.stringify(fingerprint.areas);
    expect(serializedAreas).not.toContain("candidateRuntimeSoak");
  });

  it('changing only connection health metadata does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    const connection = next.toolConnections[0] as {
      lastConnectionCheckAt: Date | null;
      lastConnectionCheckResult: string | null;
    };
    connection.lastConnectionCheckAt = new Date('2026-07-04T19:00:00Z');
    connection.lastConnectionCheckResult = 'HEALTHY';
    const after = await fingerprintFor(next);

    expect(after.hash).toBe(before.hash);
  });

  it('changing only native API-key connection check metadata does not change the hash', async () => {
    const workspace = baseWorkspace({
      toolConnections: [
        {
          toolSlug: 'tavily',
          displayName: 'Tavily',
          connectionType: 'API_KEY',
          status: 'CONNECTED',
          encryptedCredentials: 'enc-tavily-key-v1',
          composioConnectionId: null,
          lastConnectionCheckAt: null,
          lastConnectionCheckResult: null,
        },
      ],
    });
    const before = await fingerprintFor(workspace);
    const after = await fingerprintFor(baseWorkspace({
      toolConnections: [
        {
          toolSlug: 'tavily',
          displayName: 'Tavily',
          connectionType: 'API_KEY',
          status: 'CONNECTED',
          encryptedCredentials: 'enc-tavily-key-v1',
          composioConnectionId: null,
          lastConnectionCheckAt: new Date('2026-07-05T12:00:00Z'),
          lastConnectionCheckResult: 'HEALTHY',
        },
      ],
    }));

    expect(after.hash).toBe(before.hash);
  });

  it('sweep status flip CONNECTED to EXPIRED changes the tools hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace();
    // Intended: a dead connection changes the generated runtime surface on the
    // next deploy, so drift detection should accompany the expired-tool banner
    // until the user reconnects and redeploys.
    const connection = next.toolConnections[0] as {
      status: string;
      lastConnectionCheckAt: Date | null;
      lastConnectionCheckResult: string | null;
    };
    connection.status = 'EXPIRED';
    connection.lastConnectionCheckAt = new Date('2026-07-04T19:00:00Z');
    connection.lastConnectionCheckResult = 'EXPIRED';
    const after = await fingerprintFor(next);

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.tools).not.toBe(before.areas.tools);
  });

  it('template-backed workspace name changes do not drift, fallback workspace name changes do', async () => {
    const templateBackedBefore = await fingerprintFor(baseWorkspace());
    const templateBackedAfter = await fingerprintFor(baseWorkspace({ name: 'Renamed Template Claw' }));
    expect(templateBackedAfter.hash).toBe(templateBackedBefore.hash);

    const fallbackBefore = await fingerprintFor(baseWorkspace({ clawTemplateId: null, clawTemplate: null }));
    const fallbackAfter = await fingerprintFor(baseWorkspace({
      clawTemplateId: null,
      clawTemplate: null,
      name: 'Renamed Custom Claw',
    }));
    expect(fallbackAfter.hash).not.toBe(fallbackBefore.hash);
  });

  it('does not write while building a fingerprint', async () => {
    await fingerprintFor(baseWorkspace());

    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(prismaMock.deployment.update).not.toHaveBeenCalled();
  });
});
