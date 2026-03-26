import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { createWorkspaceFromTemplate } from '@/lib/workspace-from-template';

const MOCK_TEMPLATE = {
  id: 'tpl-1',
  slug: 'test-claw',
  name: 'Test Claw',
  description: 'A test template',
  price: 149,
  workspaceSnapshot: JSON.stringify({
    agents: [
      { agentSlug: 'orch', name: 'Orchestrator', role: 'ORCHESTRATOR', model: 'anthropic/claude-haiku-4-5-20251001', soulMd: 'soul', agentsMd: 'agents', color: '#5BA1F5', positionX: 0, positionY: 0 },
      { agentSlug: 'worker', name: 'Worker', role: 'WORKER', model: 'anthropic/claude-sonnet-4-6', soulMd: 'soul2', agentsMd: 'agents2', positionX: 100, positionY: 0, reportsTo: 'orch' },
    ],
    connections: [
      { sourceSlug: 'orch', targetSlug: 'worker', condition: 'ON_COMPLETE' },
    ],
  }),
};

function setupMocks() {
  (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
  (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
  (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-1', name: 'Test Claw' });
  (prismaMock.agent.create as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ id: 'agent-orch' })
    .mockResolvedValueOnce({ id: 'agent-worker' });
  (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.agentConnection.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'install-1' });
  (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
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
      }),
    };
    (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(noConnTemplate);
    (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-solo', name: 'Test Claw' });
    (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-solo' });
    (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await createWorkspaceFromTemplate({ userId: 'user-1', templateId: 'tpl-1' });
    expect(result.workspaceId).toBe('ws-solo');
    expect(prismaMock.agentConnection.create).not.toHaveBeenCalled();
  });
});
