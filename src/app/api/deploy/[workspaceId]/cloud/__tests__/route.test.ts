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

const mockEvaluateTopology = vi.fn();
vi.mock('@/lib/openclaw/deploy-topology-prerequisites', () => ({
  evaluateWorkspaceDeployTopologyPrerequisites: (...args: unknown[]) => mockEvaluateTopology(...args),
}));

const mockEvaluateProviderAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/deploy/provider-auth-prerequisites', () => ({
  MODEL_KEY_MISSING: 'MODEL_KEY_MISSING',
  evaluateWorkspaceDeployProviderAuth: (...args: unknown[]) => mockEvaluateProviderAuth(...args),
}));

vi.mock('@/lib/logger', () => ({
  log: { deployEvent: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockEvaluateCreateBudget = vi.hoisted(() => vi.fn());
const mockEnqueueProvisioning = vi.hoisted(() => vi.fn());
vi.mock('@/lib/railway/governor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/railway/governor')>(
    '@/lib/railway/governor',
  );
  return {
    ...actual,
    evaluateCreateBudget: (...args: unknown[]) => mockEvaluateCreateBudget(...args),
    enqueueProvisioning: (...args: unknown[]) => mockEnqueueProvisioning(...args),
  };
});

const mockReadRuntimeImage = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tag: string; image: string; present: boolean } | null> => null),
);
vi.mock('@/lib/openclaw/runtime-image', () => ({
  readRuntimeImage: () => mockReadRuntimeImage(),
}));

import { POST } from '@/app/api/deploy/[workspaceId]/cloud/route';
import { ProvisioningQueuedError } from '@/lib/railway/governor';

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
    delete process.env.CLAWS_PROFILE;
    mockReadRuntimeImage.mockResolvedValue(null);
    mockEvaluateToolPrereqs.mockResolvedValue({
      satisfied: true,
      missingSlugs: [],
      missingLabels: [],
      unverifiedCount: 0,
    });
    mockEvaluateTopology.mockResolvedValue({
      ok: true,
      hardErrors: [],
      softWarnings: [],
      primaryMessage: null,
    });
    mockEvaluateProviderAuth.mockResolvedValue({ ok: true });
    mockEvaluateCreateBudget.mockResolvedValue({
      allowed: true,
      cap: 25,
      margin: 2,
      usable: 23,
      rollingCount: 0,
      quotaHoldUntil: null,
      etaAt: new Date(),
    });
    mockEnqueueProvisioning.mockResolvedValue({
      workspaceId: 'ws-1',
      position: 1,
      etaAt: new Date('2026-08-20T12:00:00.000Z'),
      reason: 'budget',
      message: "High demand - your claw is queued to provision, ~24h. We'll notify you.",
    });
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await callRoute('ws-1');
    expect(res.status).toBe(401);
  });

  it('self-host expired trial deploys without a trial stamp or the create governor', async () => {
    process.env.CLAWS_PROFILE = 'self-host';
    mockReadRuntimeImage.mockResolvedValue({
      tag: '2026.5.22-18',
      image: 'ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-18',
      present: true,
    });
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'DRAFT', containerId: null },
    });
    mockEligibleUser({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      hasActiveSubscription: false,
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-1');
    expect(mockEvaluateCreateBudget).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    delete process.env.CLAWS_PROFILE;
  });

  it('returns 409 RUNTIME_IMAGE_MISSING when the self-host runtime image is absent', async () => {
    process.env.CLAWS_PROFILE = 'self-host';
    mockReadRuntimeImage.mockResolvedValue({
      tag: '2026.5.22-18',
      image: 'ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-18',
      present: false,
    });
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'SETUP_INCOMPLETE' },
    });
    const res = await callRoute('ws-1');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('RUNTIME_IMAGE_MISSING');
    expect(mockDeployToCloud).not.toHaveBeenCalled();
    delete process.env.CLAWS_PROFILE;
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

  it('Card 18: STOPPED + subscribed + topology ok → /cloud deploys (not 402)', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-sub' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-canary', status: 'STOPPED', containerId: null },
    });
    mockEligibleUser({
      id: 'user-sub',
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: true,
    });
    mockEvaluateTopology.mockResolvedValue({
      ok: true,
      hardErrors: [],
      softWarnings: [],
      primaryMessage: null,
      ignoredLegacyReviewEdges: 4,
    });

    const res = await callRoute('ws-canary');
    expect(res.status).toBe(201);
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-canary');
    expect(mockEvaluateTopology).toHaveBeenCalledWith('ws-canary');
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

  it('returns 400 TOPOLOGY_INVALID when canvas has no orch→worker edges', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEvaluateTopology.mockResolvedValue({
      ok: false,
      hardErrors: [{ code: 'NO_ORCH_WORKER_EDGES', message: 'Add a worker and connect it to your Commander.' }],
      softWarnings: [],
      primaryMessage: 'Add a worker and connect it to your Commander.',
    });
    mockEligibleUser();

    const res = await callRoute('ws-1');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('TOPOLOGY_INVALID');
    expect(mockDeployToCloud).not.toHaveBeenCalled();
  });

  it('MUTATION source lock: route must call evaluateWorkspaceDeployTopologyPrerequisites', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/deploy/[workspaceId]/cloud/route.ts'),
      'utf8',
    );
    expect(src).toContain('evaluateWorkspaceDeployTopologyPrerequisites');
    expect(src).toContain('TOPOLOGY_INVALID');
  });

  it('keyless deploy → 422 MODEL_KEY_MISSING naming the provider, before a container', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-1', status: 'DRAFT' } });
    mockEvaluateProviderAuth.mockResolvedValue({
      ok: false,
      code: 'MODEL_KEY_MISSING',
      message: 'Add an Anthropic API key before deploy',
      missingProviders: ['ANTHROPIC'],
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe('MODEL_KEY_MISSING');
    expect(json.error.message).toContain('Anthropic');
    expect(mockDeployToCloud).not.toHaveBeenCalled();
    expect(prismaMock.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('MUTATION source lock: route must call evaluateWorkspaceDeployProviderAuth (keyless bypass → fail)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/deploy/[workspaceId]/cloud/route.ts'),
      'utf8',
    );
    expect(src).toContain('evaluateWorkspaceDeployProviderAuth');
    expect(src).toContain('MODEL_KEY_MISSING');
    expect(src).toContain('422');
    const gateIdx = src.indexOf('await evaluateWorkspaceDeployProviderAuth');
    const eligibilityIdx = src.indexOf('checkDeployEligibility(user)');
    const deployIdx = src.indexOf('await deployToCloud');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(eligibilityIdx);
    expect(gateIdx).toBeLessThan(deployIdx);
  });

  it('over-cap create path → 202 queued, never DEPLOYING / deployToCloud / ERROR', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'DRAFT', containerId: null },
    });
    mockEligibleUser();
    mockEvaluateCreateBudget.mockResolvedValue({
      allowed: false,
      cap: 25,
      margin: 2,
      usable: 23,
      rollingCount: 23,
      quotaHoldUntil: null,
      etaAt: new Date('2026-08-20T12:00:00.000Z'),
    });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.queued).toBe(true);
    expect(json.data.position).toBe(1);
    expect(json.data.message).toContain('queued to provision');
    expect(mockDeployToCloud).not.toHaveBeenCalled();
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEPLOYING' }) }),
    );
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR' }) }),
    );
  });

  it('existing containerId bypasses the create governor', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'STOPPED', containerId: 'svc-keep' },
    });
    mockEligibleUser();
    mockEvaluateCreateBudget.mockResolvedValue({ allowed: false });

    const res = await callRoute('ws-1');
    expect(res.status).toBe(201);
    expect(mockEvaluateCreateBudget).not.toHaveBeenCalled();
    expect(mockDeployToCloud).toHaveBeenCalledWith('ws-1');
  });

  it('backstop: ProvisioningQueuedError from deployToCloud → 202, not DEPLOY_FAILED', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: 'ws-1', status: 'DRAFT', containerId: null },
    });
    mockEligibleUser();
    mockDeployToCloud.mockRejectedValue(
      new ProvisioningQueuedError({
        workspaceId: 'ws-1',
        position: 2,
        etaAt: new Date('2026-08-20T03:11:00.000Z'),
        reason: 'railway_quota',
        message: "High demand - your claw is queued to provision, ~4h. We'll notify you.",
      }),
    );

    const res = await callRoute('ws-1');
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.queued).toBe(true);
    expect(json.data.position).toBe(2);
    expect(json.error).toBeUndefined();
  });

  it('MUTATION: fail-on-cap restored (500 DEPLOY_FAILED on !allowed) → this test fails', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/deploy/[workspaceId]/cloud/route.ts'),
      'utf8',
    );
    expect(src).toContain('evaluateCreateBudget');
    expect(src).toContain('202');
    expect(src).toContain('queued: true');
    expect(src).toContain('isProvisioningQueuedError');
    const failOnCap = /if\s*\(\s*!budget\.allowed\s*\)[\s\S]{0,200}DEPLOY_FAILED/;
    expect(src).not.toMatch(failOnCap);
  });
});

// Legal §8 gate: first deploy of a financial template requires the stored
// acknowledgement. MUTATION: removing the gate (financial deploy-bypass) or
// the ConsentRecord write fails these.
describe('financial template §8 acknowledgement gate', () => {
  function mockFinancialWorkspace(slug: string | null) {
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      clawTemplate: slug ? { slug } : null,
    });
  }

  function callRouteWithBody(workspaceId: string, body?: unknown) {
    const req = createMockRequest(`http://localhost:3000/api/deploy/${workspaceId}/cloud`, {
      method: 'POST',
      ...(body !== undefined ? { body } : {}),
    });
    return POST(req, { params: Promise.resolve({ workspaceId }) });
  }

  beforeEach(() => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-fin' });
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: 'ws-fin', status: 'SETUP_INCOMPLETE' } });
    mockEligibleUser({ id: 'user-fin' });
    (prismaMock.consentRecord.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.consentRecord.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('quant-trader first deploy without ack → 428 FINANCIAL_TERMS_ACK_REQUIRED, trial clock NOT started', async () => {
    mockFinancialWorkspace('quant-trader');

    const res = await callRouteWithBody('ws-fin');
    expect(res.status).toBe(428);
    const json = await res.json();
    expect(json.error.code).toBe('FINANCIAL_TERMS_ACK_REQUIRED');
    expect(json.error.message).toContain("I've read the AI & autonomy terms (§8)");
    // Gate sits BEFORE the trial-start side effect.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockDeployToCloud).not.toHaveBeenCalled();
  });

  it('retry with financialAckAccepted stores the ConsentRecord (version+timestamp) and deploys', async () => {
    mockFinancialWorkspace('quant-trader');

    const res = await callRouteWithBody('ws-fin', { financialAckAccepted: true });
    expect(res.status).toBe(201);
    expect(prismaMock.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-fin',
        kind: 'FINANCIAL_AUTONOMY_S8',
        workspaceId: 'ws-fin',
        source: 'deploy-gate',
        version: expect.stringMatching(/^\d{4}-\d{2}$/),
        metadata: JSON.stringify({ templateSlug: 'quant-trader' }),
      }),
    });
    expect(mockDeployToCloud).toHaveBeenCalled();
  });

  it('subsequent deploys with a stored ack skip the gate (no re-prompt, no duplicate row)', async () => {
    mockFinancialWorkspace('quant-trader');
    (prismaMock.consentRecord.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cr-1' });

    const res = await callRouteWithBody('ws-fin');
    expect(res.status).toBe(201);
    expect(prismaMock.consentRecord.create).not.toHaveBeenCalled();
  });

  it('non-financial templates never see the gate', async () => {
    mockFinancialWorkspace('twitter-growth-machine');

    const res = await callRouteWithBody('ws-fin');
    expect(res.status).toBe(201);
    expect(prismaMock.consentRecord.findFirst).not.toHaveBeenCalled();
  });
});
