import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { createMockRequest } from '@/test/helpers/mock-request';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({ getSessionUser: () => mockGetSessionUser() }));

const mockCreateClawCheckout = vi.fn();
const mockCreatePlatformSubscription = vi.fn();
const mockCreateCommunityCheckout = vi.fn();
vi.mock('@/lib/dodo-payments', () => ({
  createClawCheckout: (...args: unknown[]) => mockCreateClawCheckout(...args),
  createPlatformSubscription: (...args: unknown[]) => mockCreatePlatformSubscription(...args),
  createCommunityCheckout: (...args: unknown[]) => mockCreateCommunityCheckout(...args),
}));

const mockCreateWorkspace = vi.fn();
vi.mock('@/lib/workspace-from-template', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workspace-from-template')>(
    '@/lib/workspace-from-template',
  );
  return {
    ...actual,
    createWorkspaceFromTemplate: (...args: unknown[]) => mockCreateWorkspace(...args),
  };
});

import { POST } from '@/app/api/dodo-payments/checkout/route';

const MOCK_USER = { id: 'user-1', email: 'test@test.com', name: 'Test', dodoCustomerId: null, workspaces: [] };
const MOCK_TEMPLATE = {
  id: 'tpl-1', slug: 'test', price: 49, isFree: false, creatorId: null, dodoProductId: 'prod_1',
  isPublished: true, trustTier: 'OFFICIAL', reviewStatus: 'APPROVED',
};
const MOCK_FREE_TEMPLATE = {
  id: 'tpl-free', slug: 'free', price: 0, isFree: true, creatorId: null, dodoProductId: null,
  isPublished: true, trustTier: 'OFFICIAL', reviewStatus: 'APPROVED',
};
const MOCK_COMMUNITY_TEMPLATE = {
  id: 'tpl-comm', slug: 'community', price: 49, isFree: false, creatorId: 'creator-1',
  dodoProductId: 'prod_comm_tpl_1',
  isPublished: true, trustTier: 'SCANNED', reviewStatus: 'APPROVED',
};
const MOCK_COMMUNITY_SKILL = {
  id: 'skill-comm', slug: 'community-skill', name: 'Community Skill', price: 29, isFree: false,
  creatorId: 'creator-1', dodoProductId: 'prod_comm_skill_1',
  isPublished: true, trustTier: 'SCANNED', reviewStatus: 'APPROVED',
};

function callCheckout(body: Record<string, unknown>) {
  const req = createMockRequest('http://localhost:3000/api/dodo-payments/checkout', { method: 'POST', body });
  return POST(req);
}

describe('POST /api/dodo-payments/checkout', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid checkout type', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
    const res = await callCheckout({ type: 'invalid_type' });
    expect(res.status).toBe(400);
  });

  describe('free_template', () => {
    it('first-install → redirectUrl /onboarding (D-vi)', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_FREE_TEMPLATE);
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-free',
        workspaceName: 'Free Claw',
        isFirstWorkspace: true,
      });

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-free' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.redirectUrl).toBe('/onboarding');
      expect(mockCreateWorkspace).toHaveBeenCalledWith({ userId: 'user-1', templateId: 'tpl-free' });
    });

    it('second-install → redirectUrl /builder/{id} (D-vi)', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_USER,
        workspaces: [{ id: 'ws-existing' }],
      });
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_FREE_TEMPLATE);
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-new',
        workspaceName: 'Free Claw 2',
        isFirstWorkspace: false,
      });

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-free' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.redirectUrl).toBe('/builder/ws-new');
      expect(mockCreateWorkspace).toHaveBeenCalledWith({ userId: 'user-1', templateId: 'tpl-free' });
    });

    it('always creates a new workspace even if already installed', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_FREE_TEMPLATE);
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-new',
        workspaceName: 'Free Claw 2',
        isFirstWorkspace: false,
      });

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-free' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.redirectUrl).toBe('/builder/ws-new');
      expect(mockCreateWorkspace).toHaveBeenCalledWith({ userId: 'user-1', templateId: 'tpl-free' });
    });

    it('rejects when template is not free', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-1' });
      expect(res.status).toBe(400);
    });
  });

  describe('claw_purchase', () => {
    it('hosted install still returns a checkout URL', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateClawCheckout.mockResolvedValue({ checkoutUrl: 'https://pay.dodo.com/test', mockMode: false });

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.checkoutUrl).toBe('https://pay.dodo.com/test');
    });

    it('creates workspace directly in mock mode', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateClawCheckout.mockResolvedValue({ checkoutUrl: null, mockMode: true });
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-mock',
        workspaceName: 'Test',
        isFirstWorkspace: true,
      });
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-mock' });

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      const json = await res.json();
      expect(json.data.mockMode).toBe(true);
      expect(json.data.redirectUrl).toBe('/onboarding');
    });

    it('creates new workspace without checkout when already purchased', async () => {
      mockCreateClawCheckout.mockClear();
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' });
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-reinstall',
        workspaceName: 'Test',
        isFirstWorkspace: false,
      });

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.redirectUrl).toBe('/builder/ws-reinstall');
      expect(mockCreateClawCheckout).not.toHaveBeenCalled();
    });

    it('returns 400 when templateId is missing', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      const res = await callCheckout({ type: 'claw_purchase' });
      expect(res.status).toBe(400);
    });
  });

  describe('community_purchase', () => {
    beforeEach(() => {
      process.env.MARKETPLACE_COMMUNITY_PURCHASE_ENABLED = 'true';
    });
    afterEach(() => {
      delete process.env.MARKETPLACE_COMMUNITY_PURCHASE_ENABLED;
    });

    it('returns COMING_SOON when community purchase flag is OFF', async () => {
      delete process.env.MARKETPLACE_COMMUNITY_PURCHASE_ENABLED;
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.error?.code).toBe('COMING_SOON');
    });

    it('creates checkout for community template with stored dodoProductId (not cuid)', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateCommunityCheckout.mockResolvedValue({ checkoutUrl: 'https://pay.dodo.com/community', mockMode: false });

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.checkoutUrl).toBe('https://pay.dodo.com/community');
      expect(mockCreateCommunityCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          dodoProductId: 'prod_comm_tpl_1',
          templateId: 'tpl-comm',
        }),
      );
      const passed = mockCreateCommunityCheckout.mock.calls[0][0] as { dodoProductId: string; templateId: string };
      expect(passed.dodoProductId).not.toBe(passed.templateId);
    });

    it('rejects community template when dodoProductId missing (approve mint required)', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_COMMUNITY_TEMPLATE,
        dodoProductId: null,
      });
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error?.code).toBe('PRODUCT_NOT_READY');
    });

    it('skill purchase e2e (mock): mints MarketplaceSale at 3.5% + SkillInstall', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_SKILL);
      (prismaMock.marketplaceSale.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateCommunityCheckout.mockResolvedValue({ checkoutUrl: null, mockMode: true });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-skill' });
      (prismaMock.skillInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'si-1' });

      const res = await callCheckout({ type: 'community_purchase', skillId: 'skill-comm' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.mockMode).toBe(true);
      expect(json.data.purchased).toBe(true);
      expect(mockCreateCommunityCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          dodoProductId: 'prod_comm_skill_1',
          skillId: 'skill-comm',
        }),
      );
      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.skillId).toBe('skill-comm');
      expect(saleCall.data.processingFee).toBeCloseTo(29 * 0.035, 2);
      expect(saleCall.data.payoutStatus).toBe('PENDING');
      expect(prismaMock.skillInstall.upsert).toHaveBeenCalled();
    });

    it('creates MarketplaceSale in mock mode with correct fee math', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateCommunityCheckout.mockResolvedValue({ checkoutUrl: null, mockMode: true });
      mockCreateWorkspace.mockResolvedValue({
        workspaceId: 'ws-comm',
        workspaceName: 'Community',
        isFirstWorkspace: true,
      });
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-comm' });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-1' });

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(json.data.mockMode).toBe(true);
      expect(json.data.redirectUrl).toBe('/onboarding');

      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.creatorId).toBe('creator-1');
      expect(saleCall.data.amount).toBe(49);
      expect(saleCall.data.payoutStatus).toBe('PENDING');
      expect(saleCall.data.processingFee).toBeCloseTo(49 * 0.035, 2);
      expect(saleCall.data.creatorPayout).toBeCloseTo(49 - 49 * 0.035, 2);
      expect(saleCall.data.processingFee + saleCall.data.creatorPayout).toBeCloseTo(49, 1);
      expect(saleCall.data.payoutHeldUntil).toBeInstanceOf(Date);
    });

    it('refuses owner==buyer with 403 OWN_LISTING (creator.userId, not profile id)', async () => {
      mockCreateCommunityCheckout.mockClear();
      mockCreateWorkspace.mockClear();
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockClear();
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_COMMUNITY_TEMPLATE,
        creatorId: 'cprof-1',
        creator: { userId: 'user-1' },
      });

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.error?.code).toBe('OWN_LISTING');
      expect(json.error?.message).toBe('This is your template');
      expect(mockCreateCommunityCheckout).not.toHaveBeenCalled();
      expect(prismaMock.marketplaceSale.create).not.toHaveBeenCalled();
      expect(mockCreateWorkspace).not.toHaveBeenCalled();
    });

    it('refuses skill owner==buyer with 403 OWN_LISTING', async () => {
      mockCreateCommunityCheckout.mockClear();
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockClear();
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_COMMUNITY_SKILL,
        creatorId: 'cprof-skill',
        creator: { userId: 'user-1' },
      });

      const res = await callCheckout({ type: 'community_purchase', skillId: 'skill-comm' });
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.error?.code).toBe('OWN_LISTING');
      expect(json.error?.message).toBe('This is your skill');
      expect(mockCreateCommunityCheckout).not.toHaveBeenCalled();
      expect(prismaMock.marketplaceSale.create).not.toHaveBeenCalled();
    });

    it('MUTATION: self-buy path restored → fail', () => {
      const src = readFileSync(
        join(process.cwd(), 'src/app/api/dodo-payments/checkout/route.ts'),
        'utf8',
      );
      expect(src).toContain('isOwnListing');
      expect(src).toContain('OWN_LISTING');
      expect(src).toContain('ownListingMessage("template")');
      expect(src).toContain('ownListingMessage("skill")');
      expect(src).not.toMatch(/template\.creatorId === user\.id/);
      expect(src).not.toMatch(/skill\.creatorId === user\.id/);
    });

    it('rejects when template has no creatorId', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-1' });
      expect(res.status).toBe(400);
    });

    it('rejects community template with price below $19', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...MOCK_COMMUNITY_TEMPLATE, price: 10 });
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      expect(res.status).toBe(400);
    });
  });

  describe('claw_platform', () => {
    it('creates platform subscription checkout', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-1', userId: 'user-1' });
      mockCreatePlatformSubscription.mockResolvedValue({ checkoutUrl: 'https://pay.dodo.com/sub', mockMode: false });

      const res = await callCheckout({ type: 'claw_platform', workspaceId: 'ws-1' });
      const json = await res.json();
      expect(json.data.checkoutUrl).toBe('https://pay.dodo.com/sub');
    });

    it('activates subscription in mock mode', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-1', userId: 'user-1' });
      mockCreatePlatformSubscription.mockResolvedValue({ checkoutUrl: null, mockMode: true });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await callCheckout({ type: 'claw_platform', workspaceId: 'ws-1' });
      const json = await res.json();
      expect(json.data.mockMode).toBe(true);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { hasActiveSubscription: true } }),
      );
    });

    it('picks an owned workspace when workspaceId is omitted (billing lapsed path)', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_USER,
        workspaces: [{ id: 'ws-owned' }],
      });
      mockCreatePlatformSubscription.mockResolvedValue({
        checkoutUrl: 'https://pay.dodo.com/sub-billing',
        mockMode: false,
      });

      const res = await callCheckout({
        type: 'claw_platform',
        returnUrl: '/settings?tab=billing&subscribed=1',
      });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.checkoutUrl).toBe('https://pay.dodo.com/sub-billing');
      expect(mockCreatePlatformSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-owned',
          returnUrl: expect.stringContaining('/settings?tab=billing&subscribed=1'),
          dodoCustomerId: undefined,
        }),
      );
    });

    it('returns 400 when workspaceId is missing and account has no workspaces', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await callCheckout({ type: 'claw_platform' });
      expect(res.status).toBe(400);
    });

    it('passes dodoCustomerId into platform subscription when present', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...MOCK_USER,
        dodoCustomerId: 'cus_abc',
      });
      (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ws-1',
        userId: 'user-1',
      });
      mockCreatePlatformSubscription.mockResolvedValue({
        checkoutUrl: 'https://pay.dodo.com/sub',
        mockMode: false,
      });

      await callCheckout({ type: 'claw_platform', workspaceId: 'ws-1' });
      expect(mockCreatePlatformSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ dodoCustomerId: 'cus_abc' }),
      );
    });
  });

  it('MUTATION source lock: checkout must use installLandingPath (hardcode /builder → fail)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/dodo-payments/checkout/route.ts'),
      'utf8',
    );
    expect(src).toContain('installLandingPath');
    expect(src).toContain('isFirstWorkspace');
    // Immediate-install success paths must not hardcode /builder/.
    expect(src).not.toMatch(/redirectUrl:\s*`\/builder\/\$\{workspaceId\}`/);
  });

  describe('error handling', () => {
    it('returns 500 when Dodo SDK throws', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateClawCheckout.mockRejectedValue(new Error('Dodo API connection refused'));

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('CHECKOUT_FAILED');
    });

    it('returns 404 when template does not exist', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-ghost' });
      expect(res.status).toBe(404);
    });
  });
});
