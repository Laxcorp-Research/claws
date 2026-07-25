import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockLogWarn = vi.fn();
vi.mock('@/lib/logger', () => ({
  log: { warn: (...args: unknown[]) => mockLogWarn(...args), error: vi.fn(), info: vi.fn() },
}));

import { createWorkspaceFromTemplate } from '@/lib/workspace-from-template';

const SNAPSHOT_TOOLS = [
  {
    slug: 'twitter-api',
    name: 'Twitter/X API',
    category: 'Social',
    connectionType: 'API_KEY',
    required: true,
  },
  {
    slug: 'tavily',
    name: 'Tavily',
    category: 'Research',
    connectionType: 'API_KEY',
    required: false,
  },
];

const MOCK_TEMPLATE = {
  id: 'tpl-1',
  slug: 'test-claw',
  name: 'Test Claw',
  description: 'A test template',
  price: 49,
  workspaceSnapshot: JSON.stringify({
    agents: [
      { agentSlug: 'orch', name: 'Orchestrator', role: 'ORCHESTRATOR', model: 'anthropic/claude-haiku-4-5-20251001', soulMd: 'soul', agentsMd: 'agents', color: '#5BA1F5', positionX: 0, positionY: 0 },
      { agentSlug: 'worker', name: 'Worker', role: 'WORKER', model: 'anthropic/claude-sonnet-4-6', soulMd: 'soul2', agentsMd: 'agents2', positionX: 100, positionY: 0, reportsTo: 'orch' },
    ],
    connections: [
      { sourceSlug: 'orch', targetSlug: 'worker', condition: 'ON_COMPLETE' },
    ],
    tools: SNAPSHOT_TOOLS,
  }),
};

function setupMocks() {
  (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
  (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
  // name-suffix count (often 0) then completeOnboardingAfterFirstWorkspace (1).
  (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockImplementation(
    async () => {
      const calls = (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mock.calls.length
      // After create, the completion helper sees 1 workspace.
      return calls <= 1 ? 0 : 1
    },
  );
  (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-1', name: 'Test Claw' });
  (prismaMock.agent.create as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ id: 'agent-orch' })
    .mockResolvedValueOnce({ id: 'agent-worker' });
  (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.agentConnection.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'install-1' });
  (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe('createWorkspaceFromTemplate', () => {
  it('creates workspace, agents, connections, install, and increments count', async () => {
    setupMocks();
    const result = await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });

    expect(result.workspaceId).toBe('ws-1');
    expect(result.workspaceName).toBe('Test Claw');
    expect(prismaMock.workspace.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.agent.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.agentConnection.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.templateInstall.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { installCount: { increment: 1 } } }),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { onboardingCompleted: true },
    });
    expect(result.isFirstWorkspace).toBe(true);
  });

  it('seeds toolRequirements from snapshot.tools (MUTATION: skip copy → fail)', async () => {
    setupMocks();
    await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });

    expect(prismaMock.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolRequirements: SNAPSHOT_TOOLS,
        }),
      }),
    );
    // Template JSON must remain untouched — only installCount update on template.
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { installCount: { increment: 1 } },
      }),
    );
    expect(prismaMock.clawTemplate.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceSnapshot: expect.anything() }),
      }),
    );
  });

  it('creates workspace with SETUP_INCOMPLETE status', async () => {
    setupMocks();
    await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });

    expect(prismaMock.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SETUP_INCOMPLETE', clawTemplateId: 'tpl-1' }),
      }),
    );
  });

  it('sets reportsTo on agents that reference other agents', async () => {
    setupMocks();
    await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });

    expect(prismaMock.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agent-worker' },
        data: { reportsTo: 'agent-orch' },
      }),
    );
  });

  it('upserts template install with compound unique key', async () => {
    setupMocks();
    await createWorkspaceFromTemplate({ userId: 'user-99', templateId: 'tpl-1' });

    expect(prismaMock.templateInstall.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { templateId_userId: { templateId: 'tpl-1', userId: 'user-99' } },
      }),
    );
  });

  it('propagates transaction failure (no partial state)', async () => {
    (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DB connection lost'),
    );
    (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);

    await expect(
      createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' }),
    ).rejects.toThrow('DB connection lost');
  });

  it('handles templates with no connections gracefully', async () => {
    const noConnTemplate = {
      ...MOCK_TEMPLATE,
      workspaceSnapshot: JSON.stringify({
        agents: [{ agentSlug: 'solo', name: 'Solo', role: 'WORKER', model: 'm', soulMd: 's', agentsMd: 'a' }],
        tools: SNAPSHOT_TOOLS,
      }),
    };
    (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(noConnTemplate);
    (prismaMock.workspace.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-solo', name: 'Test Claw' });
    (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-solo' });
    (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });
    expect(result.workspaceId).toBe('ws-solo');
    expect(prismaMock.agentConnection.create).not.toHaveBeenCalled();
  });

  it('APPLYs agents[].skills into AgentSkill rows (MUTATION: drop materialization → fail)', async () => {
    const withSkills = {
      ...MOCK_TEMPLATE,
      workspaceSnapshot: JSON.stringify({
        agents: [
          {
            agentSlug: 'orch',
            name: 'Orchestrator',
            role: 'ORCHESTRATOR',
            model: 'm',
            soulMd: 's',
            agentsMd: 'a',
            skills: [
              { slug: 'web-search', name: 'Web Search', configOverrides: null },
              { slug: 'github', name: 'GitHub', configOverrides: '{"repo":"x"}' },
            ],
          },
        ],
        tools: SNAPSHOT_TOOLS,
      }),
    };
    setupMocks();
    (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(withSkills);
    (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-orch' });
    (prismaMock.skill.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'skill-web' })
      .mockResolvedValueOnce({ id: 'skill-gh' });
    (prismaMock.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });

    expect(prismaMock.skill.findUnique).toHaveBeenCalledWith({
      where: { slug: 'web-search' },
      select: { id: true },
    });
    expect(prismaMock.skill.findUnique).toHaveBeenCalledWith({
      where: { slug: 'github' },
      select: { id: true },
    });
    expect(prismaMock.agentSkill.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.agentSkill.create).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-orch',
        skillId: 'skill-web',
        configOverrides: null,
      },
    });
    expect(prismaMock.agentSkill.create).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-orch',
        skillId: 'skill-gh',
        configOverrides: '{"repo":"x"}',
      },
    });
  });

  it('stale skill slug → install succeeds + WARN + row skipped', async () => {
    const withStale = {
      ...MOCK_TEMPLATE,
      workspaceSnapshot: JSON.stringify({
        agents: [
          {
            agentSlug: 'orch',
            name: 'Orchestrator',
            role: 'ORCHESTRATOR',
            model: 'm',
            soulMd: 's',
            agentsMd: 'a',
            skills: [
              { slug: 'gone-skill', name: 'Gone' },
              { slug: 'web-search', name: 'Web Search' },
            ],
          },
        ],
        tools: SNAPSHOT_TOOLS,
      }),
    };
    setupMocks();
    mockLogWarn.mockClear();
    (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(withStale);
    (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-orch' });
    (prismaMock.skill.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'skill-web' });
    (prismaMock.agentSkill.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });
    expect(result.workspaceId).toBe('ws-1');
    expect(mockLogWarn).toHaveBeenCalledWith(
      'createWorkspaceFromTemplate: skipping stale skill slug',
      expect.objectContaining({ slug: 'gone-skill', agentSlug: 'orch' }),
    );
    expect(prismaMock.agentSkill.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.agentSkill.create).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-orch',
        skillId: 'skill-web',
        configOverrides: null,
      },
    });
  });

  it('MUTATION source lock: skills APPLY loop must stay in createWorkspaceFromTemplate', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/workspace-from-template.ts'),
      'utf8',
    );
    expect(src).toContain('agentSkill.create');
    expect(src).toContain('skipping stale skill slug');
    expect(src).toContain('a.skills ?? []');
  });

  it('second workspace → isFirstWorkspace false', async () => {
    setupMocks();
    (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockImplementation(async () => 2);

    const result = await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });
    expect(result.isFirstWorkspace).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
