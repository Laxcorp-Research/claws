import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({ getSessionUser: () => mockGetSessionUser() }));

const mockVerifyOwnership = vi.fn();
vi.mock('@/lib/api/ownership', () => ({ verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args) }));

import { POST } from '@/app/api/deploy/[workspaceId]/cloud/route';

function callRoute(workspaceId: string) {
  const req = createMockRequest(`http://localhost:3000/api/deploy/${workspaceId}/cloud`, { method: 'POST' });
  return POST(req, { params: Promise.resolve({ workspaceId }) });
}

function mockEligibleUser(overrides: Record<string, unknown> = {}) {
  (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'user-1', trialUsed: false, trialStartedAt: null, trialEndsAt: null, hasActiveSubscription: false,
    ...overrides,
  });
  (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (prismaMock.deployment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'dep-1', status: 'PENDING', version: 1 });
  (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe('POST /api/deploy/[workspaceId]/cloud', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await callRoute('ws-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when workspace not found', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: 'NOT_FOUND', workspace: null });
    const res = await callRoute('ws-missing');
    expect(res.status).toBe(404);
  });

  it('returns 403 when user does not own workspace', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: 'FORBIDDEN', workspace: null });
    const res = await callRoute('ws-other');
    expect(res.status).toBe(403);
  });

  it('returns 400 when workspace is already running', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'RUNNING' } });
    const res = await callRoute('ws-1');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('ALREADY_RUNNING');
  });

  it('starts 3-day trial on first deploy', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-trial' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'SETUP_INCOMPLETE' } });
    mockEligibleUser({ id: 'user-trial', trialUsed: false });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);

    const updateCall = (prismaMock.user.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateCall.data.trialUsed).toBe(true);
    expect(updateCall.data.trialStartedAt).toBeInstanceOf(Date);
    expect(updateCall.data.trialEndsAt).toBeInstanceOf(Date);
  });

  it('returns 402 when trial expired and no subscription', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-expired' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'PAUSED' } });
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-expired', trialUsed: true,
      trialStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: false,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('allows deploy during active trial window', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-intrial' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'PAUSED' } });
    mockEligibleUser({
      id: 'user-intrial', trialUsed: true,
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: false,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
  });

  it('allows deploy with active subscription regardless of trial', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-sub' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'PAUSED' } });
    mockEligibleUser({
      id: 'user-sub', trialUsed: true,
      trialStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: true,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
  });

  it('creates deployment record and returns it', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.deployment.id).toBe('dep-1');
    expect(json.data.deployment.status).toBe('PENDING');
    expect(prismaMock.deployment.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEPLOYING' }) })
    );
  });
});
