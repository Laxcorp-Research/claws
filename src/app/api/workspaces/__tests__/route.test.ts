import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest, parseResponse } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/api/auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: 'user-test-123',
    email: 'test@example.com',
    name: 'Test User',
    hasActiveSubscription: false,
  }),
}));

vi.mock("@/lib/artifacts/pending-approvals", () => ({
  countPendingApprovalsByWorkspace: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/models', () => ({
  DEFAULT_MODEL: {
    ORCHESTRATOR: 'anthropic/claude-haiku-4-5-20251001',
    WORKER: 'anthropic/claude-sonnet-4-6',
    CRITIC: 'anthropic/claude-opus-4-6',
  },
}));

import { GET, POST } from '@/app/api/workspaces/route';

describe('GET /api/workspaces', () => {
  it('returns 401 when not authenticated', async () => {
    const { getSessionUser } = await import('@/lib/api/auth');
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns only the authenticated user workspaces', async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ws-1',
        name: 'My Claw',
        slug: 'my-claw',
        status: 'DRAFT',
        userId: 'user-test-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { agents: 3 },
        clawTemplate: { name: 'Template', category: 'FINANCE' },
      },
    ]);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data[0].pendingApprovalCount).toBe(0);
    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-test-123' },
      })
    );
  });
});

describe('POST /api/workspaces', () => {
  it('returns 401 when not authenticated', async () => {
    const { getSessionUser } = await import('@/lib/api/auth');
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const req = createMockRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      body: { name: 'New Claw' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('enforces workspace limit (20 max)', async () => {
    (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockResolvedValue(20);
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createMockRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      body: { name: 'Over Limit Claw' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('rejects missing name', async () => {
    const req = createMockRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      body: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates a workspace with Orchestrator + Critic and ZERO solid edges', async () => {
    (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const mockTx = {
      workspace: {
        create: vi.fn().mockResolvedValue({ id: 'ws-new', name: 'New Claw', slug: 'new-claw' }),
        count: vi.fn().mockResolvedValue(1),
      },
      agent: { create: vi.fn()
        .mockResolvedValueOnce({ id: 'orch-1' })
        .mockResolvedValueOnce({ id: 'critic-1' }) },
      agentConnection: { create: vi.fn().mockResolvedValue({ id: 'conn-1' }) },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    (prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)
    );

    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ws-new', name: 'New Claw', slug: 'new-claw',
        agents: [{ id: 'orch-1', role: 'ORCHESTRATOR' }, { id: 'critic-1', role: 'CRITIC' }],
        connections: [],
      });

    const req = createMockRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      body: { name: 'New Claw' },
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(201);
    expect(data.success).toBe(true);
    expect(mockTx.agent.create).toHaveBeenCalledTimes(2);
    // WIRE-FULL: blank create must not seed orch→critic (or any) solid edge.
    expect(mockTx.agentConnection.create).not.toHaveBeenCalled();
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-test-123' },
      data: { onboardingCompleted: true },
    });
  });

  it('reuses existing DRAFT My Claw 1 (idempotent onboarding create)', async () => {
    (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-orphan' });
    (prismaMock.user.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ws-orphan',
      name: 'My Claw 1',
      status: 'DRAFT',
      agents: [],
      connections: [],
    });

    const req = createMockRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      body: { name: 'My Claw 1' },
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.data.id).toBe('ws-orphan');
    expect(prismaMock.workspace.create).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-test-123', onboardingCompleted: false },
      data: { onboardingCompleted: true },
    });
  });
});
