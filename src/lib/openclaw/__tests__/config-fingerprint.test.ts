import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { buildWorkspaceConfigFingerprint } from '@/lib/openclaw/config-fingerprint';

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
      },
    ],
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

  it('timezone changes change the workspace area hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({ timezone: 'America/New_York' }));

    expect(after.hash).not.toBe(before.hash);
    expect(after.areas.workspace).not.toBe(before.areas.workspace);
  });

  it('cosmetic position, pause, health, and timestamp fields do not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const next = baseWorkspace({
      healthStatus: 'UNHEALTHY',
      lastHealthCheck: new Date('2026-02-01T00:00:00Z'),
      lastEnvReconcileAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });
    next.agents[0].positionX = 999;
    next.agents[0].positionY = 999;
    next.agents[0].isPaused = true;
    next.agents[0].lastActiveAt = new Date('2026-02-01T00:00:00Z');
    const after = await fingerprintFor(next);

    expect(after.hash).toBe(before.hash);
  });

  it('changing only composioToolRouterSessionId does not change the hash', async () => {
    const before = await fingerprintFor(baseWorkspace());
    const after = await fingerprintFor(baseWorkspace({ composioToolRouterSessionId: 'trs-recreated' }));

    expect(after.hash).toBe(before.hash);
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
