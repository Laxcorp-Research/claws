import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({ getSessionUser: () => mockGetSessionUser() }));

const mockVerifyOwnership = vi.fn();
vi.mock('@/lib/api/ownership', () => ({ verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args) }));

describe('Security: Auth enforcement on API routes', () => {
  beforeEach(() => {
    mockGetSessionUser.mockReset();
    mockVerifyOwnership.mockReset();
  });
  describe('Agent routes require authentication', () => {
    it('GET /api/agents/[workspaceId] returns 401 when unauthenticated', async () => {
      const { GET } = await import('@/app/api/agents/[workspaceId]/route');
      mockGetSessionUser.mockResolvedValue(null);
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1');
      const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(401);
    });

    it('POST /api/agents/[workspaceId] returns 401 when unauthenticated', async () => {
      const { POST } = await import('@/app/api/agents/[workspaceId]/route');
      mockGetSessionUser.mockResolvedValue(null);
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1', { method: 'POST', body: { name: 'Evil Agent' } });
      const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(401);
    });
  });

  describe('Agent routes enforce workspace ownership', () => {
    it('GET returns 403 for non-owner', async () => {
      const { GET } = await import('@/app/api/agents/[workspaceId]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-attacker' });
      mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1');
      const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(403);
    });

    it('PATCH returns 403 for non-owner', async () => {
      const { PATCH } = await import('@/app/api/agents/[workspaceId]/[id]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-attacker' });
      mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1/agent-1', { method: 'PATCH', body: { name: 'Hijacked' } });
      const res = await PATCH(req, { params: Promise.resolve({ workspaceId: 'ws-1', id: 'agent-1' }) });
      expect(res.status).toBe(403);
    });

    it('DELETE returns 403 for non-owner', async () => {
      const { DELETE } = await import('@/app/api/agents/[workspaceId]/[id]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-attacker' });
      mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1/agent-1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1', id: 'agent-1' }) });
      expect(res.status).toBe(403);
    });
  });

  describe('Deploy routes enforce ownership', () => {
    it('GET /api/deploy/[workspaceId]/status returns 403 for non-owner', async () => {
      const { GET } = await import('@/app/api/deploy/[workspaceId]/status/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-attacker' });
      mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
      const req = createMockRequest('http://localhost:3000/api/deploy/ws-1/status');
      const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(403);
    });

    it('POST /api/deploy/[workspaceId]/stop returns 403 for non-owner', async () => {
      const { POST } = await import('@/app/api/deploy/[workspaceId]/stop/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-attacker' });
      mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
      const req = createMockRequest('http://localhost:3000/api/deploy/ws-1/stop', { method: 'POST' });
      const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(403);
    });
  });

  describe('Agent input validation', () => {
    it('blocks SOUL.md over 50000 characters', async () => {
      const { PATCH } = await import('@/app/api/agents/[workspaceId]/[id]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1' } });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1/agent-1', {
        method: 'PATCH',
        body: { soulMd: 'x'.repeat(50001) },
      });
      const res = await PATCH(req, { params: Promise.resolve({ workspaceId: 'ws-1', id: 'agent-1' }) });
      expect(res.status).toBe(400);
    });

    it('prevents deleting Orchestrator role', async () => {
      const { DELETE } = await import('@/app/api/agents/[workspaceId]/[id]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1' } });
      (prismaMock.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-1', role: 'ORCHESTRATOR' });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1/agent-1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1', id: 'agent-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('ROLE_PROTECTED');
    });

    it('prevents deleting Critic role', async () => {
      const { DELETE } = await import('@/app/api/agents/[workspaceId]/[id]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1' } });
      (prismaMock.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-1', role: 'CRITIC' });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1/agent-1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1', id: 'agent-1' }) });
      expect(res.status).toBe(400);
    });

    it('enforces 10-agent limit per workspace', async () => {
      const { POST } = await import('@/app/api/agents/[workspaceId]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1' } });
      (prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.agent.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1', { method: 'POST', body: { name: 'Agent 11' } });
      const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(403);
    });

    it('rejects duplicate Orchestrator in same workspace', async () => {
      const { POST } = await import('@/app/api/agents/[workspaceId]/route');
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1' } });
      (prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing-orch', role: 'ORCHESTRATOR' });
      const req = createMockRequest('http://localhost:3000/api/agents/ws-1', { method: 'POST', body: { name: 'Second Orch', role: 'ORCHESTRATOR' } });
      const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('Webhook signature verification', () => {
    it('returns 200 even with bad signature (no retry)', async () => {
      const { POST } = await import('@/app/api/dodo-payments/webhook/route');
      const req = new (await import('next/server')).NextRequest(
        new URL('http://localhost:3000/api/dodo-payments/webhook'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'webhook-id': 'bad',
            'webhook-signature': 'forged_signature',
            'webhook-timestamp': '0',
          },
          body: JSON.stringify({ event_type: 'payment.succeeded', data: { metadata: { type: 'claw_purchase', userId: 'u1', templateId: 't1' } } }),
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.purchase.create).not.toHaveBeenCalled();
    });
  });
});
