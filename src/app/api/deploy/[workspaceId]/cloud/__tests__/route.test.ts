import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@/generated/prisma/client';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({ getSessionUser: () => mockGetSessionUser() }));

const mockVerifyOwnership = vi.fn();
vi.mock('@/lib/api/ownership', () => ({ verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args) }));

const mockDeployToCloud = vi.fn();
vi.mock('@/lib/openclaw/deployer', () => ({ deployToCloud: (...args: unknown[]) => mockDeployToCloud(...args) }));

const mockEvaluateToolPrereqs = vi.fn();
vi.mock('@/lib/tools/deploy-tool-prerequisites', () => ({
  evaluateWorkspaceDeployToolPrerequisites: (...args: unknown[]) => mockEvaluateToolPrereqs(...args),
}));

vi.mock('@/lib/logger', () => ({
  log: { deployEvent: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { POST } from '@/app/api/deploy/[workspaceId]/cloud/route';

// Mirrors the exact `select` block in the route. If the route adds/removes
// a selected field, TypeScript will flag every user-mock site in this file.
// This is what prevents the class of drift that caused the previous CI break.
type EligibilityUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    trialUsed: true;
    trialStartedAt: true;
    trialEndsAt: true;
    hasActiveSubscription: true;
  };
}>;

function makeEligibilityUser(overrides: Partial<EligibilityUser> = {}): EligibilityUser {
  return {
    id: 'user-1',
    trialUsed: false,
    trialStartedAt: null,
    trialEndsAt: null,
    hasActiveSubscription: false,
    ...overrides,
  };
}

function callRoute(workspaceId: string) {
  const req = createMockRequest(`http://localhost:3000/api/deploy/${workspaceId}/cloud`, { method: 'POST' });
  return POST(req, { params: Promise.resolve({ workspaceId }) });
}

function mockEligibleUser(overrides: Partial<EligibilityUser> = {}) {
  (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
    makeEligibilityUser(overrides),
  );
  (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  mockDeployToCloud.mockResolvedValue({
    deploymentId: 'dep-1',
    containerId: 'sim-ws1',
    gatewayToken: 'test-token',
  });
}

describe('POST /api/deploy/[workspaceId]/cloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateToolPrereqs.mockResolvedValue({
      satisfied: true,
      missingSlugs: [],
      missingLabels: [],
      unverifiedCount: 0,
    });
  });

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
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'RUNNING', containerId: 'c-1' },
    });
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
    (prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeEligibilityUser({
        id: 'user-expired',
        trialUsed: true,
        trialStartedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        hasActiveSubscription: false,
      }),
    );

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

  it('calls deployToCloud and returns deployment result', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.deployment.id).toBe('dep-1');
    expect(json.data.deployment.containerId).toBe('sim-ws1');
    expect(json.data.deployment.status).toBe('COMPLETED');
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-1');
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEPLOYING' }) })
    );
  });

  it('returns 500 when deployToCloud fails', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();
    mockDeployToCloud.mockRejectedValue(new Error('Container agent unreachable'));

    const res = await callRoute('ws-1');
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('DEPLOY_FAILED');
  });

  it('satisfied required tools → proceeds to deployToCloud', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();
    mockEvaluateToolPrereqs.mockResolvedValue({
      satisfied: true,
      missingSlugs: [],
      missingLabels: [],
      unverifiedCount: 0,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    expect(mockEvaluateToolPrereqs).toHaveBeenCalledWith('ws-1');
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-1');
  });

  it('missing required tools → 400 naming the tools (before eligibility side effects)', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();
    mockEvaluateToolPrereqs.mockResolvedValue({
      satisfied: false,
      missingSlugs: ['tavily'],
      missingLabels: ['Tavily'],
      unverifiedCount: 0,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('REQUIRED_TOOLS_MISSING');
    expect(json.error.message).toContain('Tavily');
    expect(mockDeployToCloud).not.toHaveBeenCalled();
    expect(prismaMock.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('credentialed PENDING-unverified → proceeds', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEligibleUser();
    mockEvaluateToolPrereqs.mockResolvedValue({
      satisfied: true,
      missingSlugs: [],
      missingLabels: [],
      unverifiedCount: 1,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-1');
  });

  it('MUTATION source lock: route must call evaluateWorkspaceDeployToolPrerequisites (bypass → fail)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/deploy/[workspaceId]/cloud/route.ts'),
      'utf8',
    );
    expect(src).toContain('evaluateWorkspaceDeployToolPrerequisites');
    expect(src).toContain('REQUIRED_TOOLS_MISSING');
    // Gate must run before eligibility / trial stamp / deployToCloud (call sites).
    const gateIdx = src.indexOf('await evaluateWorkspaceDeployToolPrerequisites');
    const eligibilityIdx = src.indexOf('checkDeployEligibility(user)');
    const deployIdx = src.indexOf('await deployToCloud');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(eligibilityIdx);
    expect(gateIdx).toBeLessThan(deployIdx);
  });
});
