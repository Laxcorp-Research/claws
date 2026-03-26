import { describe, it, expect, vi } from 'vitest';
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
vi.mock('@/lib/workspace-from-template', () => ({
  createWorkspaceFromTemplate: (...args: unknown[]) => mockCreateWorkspace(...args),
}));

import { POST } from '@/app/api/dodo-payments/checkout/route';

const MOCK_USER = { id: 'user-1', email: 'test@test.com', name: 'Test', dodoCustomerId: null, workspaces: [] };
const MOCK_TEMPLATE = { id: 'tpl-1', slug: 'test', price: 149, isFree: false, creatorId: null, dodoProductId: 'prod_1' };
const MOCK_FREE_TEMPLATE = { id: 'tpl-free', slug: 'free', price: 0, isFree: true, creatorId: null, dodoProductId: null };
const MOCK_COMMUNITY_TEMPLATE = { id: 'tpl-comm', slug: 'community', price: 49, isFree: false, creatorId: 'creator-1', dodoProductId: null };

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
    it('creates workspace directly without Dodo checkout', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_FREE_TEMPLATE);
      (prismaMock.templateInstall.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateWorkspace.mockResolvedValue({ workspaceId: 'ws-free', workspaceName: 'Free Claw' });

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-free' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.redirectUrl).toContain('ws-free');
      expect(mockCreateWorkspace).toHaveBeenCalledWith({ userId: 'user-1', templateId: 'tpl-free' });
    });

    it('rejects when template is not free', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-1' });
      expect(res.status).toBe(400);
    });

    it('redirects to existing workspace if already installed', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_FREE_TEMPLATE);
      (prismaMock.templateInstall.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' });
      (prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-existing' });

      const res = await callCheckout({ type: 'free_template', templateId: 'tpl-free' });
      const json = await res.json();
      expect(json.data.redirectUrl).toContain('ws-existing');
    });
  });

  describe('claw_purchase', () => {
    it('returns checkout URL in live mode', async () => {
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
      mockCreateWorkspace.mockResolvedValue({ workspaceId: 'ws-mock', workspaceName: 'Test' });
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-mock' });

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      const json = await res.json();
      expect(json.data.mockMode).toBe(true);
      expect(json.data.redirectUrl).toContain('ws-mock');
    });

    it('rejects duplicate purchase', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing' });

      const res = await callCheckout({ type: 'claw_purchase', templateId: 'tpl-1' });
      expect(res.status).toBe(409);
    });

    it('returns 400 when templateId is missing', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      const res = await callCheckout({ type: 'claw_purchase' });
      expect(res.status).toBe(400);
    });
  });

  describe('community_purchase', () => {
    it('creates checkout for community template', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateCommunityCheckout.mockResolvedValue({ checkoutUrl: 'https://pay.dodo.com/community', mockMode: false });

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.checkoutUrl).toBe('https://pay.dodo.com/community');
    });

    it('creates MarketplaceSale in mock mode with correct fee math', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockCreateCommunityCheckout.mockResolvedValue({ checkoutUrl: null, mockMode: true });
      mockCreateWorkspace.mockResolvedValue({ workspaceId: 'ws-comm', workspaceName: 'Community' });
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'p-comm' });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-1' });

      const res = await callCheckout({ type: 'community_purchase', templateId: 'tpl-comm' });
      const json = await res.json();
      expect(json.data.mockMode).toBe(true);

      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.creatorId).toBe('creator-1');
      expect(saleCall.data.amount).toBe(49);
      expect(saleCall.data.payoutStatus).toBe('PENDING');
      expect(saleCall.data.processingFee).toBeCloseTo(49 * 0.035, 2);
      expect(saleCall.data.creatorPayout).toBeCloseTo(49 - 49 * 0.035, 2);
      expect(saleCall.data.processingFee + saleCall.data.creatorPayout).toBeCloseTo(49, 1);
      expect(saleCall.data.payoutHeldUntil).toBeInstanceOf(Date);
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

    it('returns 400 when workspaceId is missing', async () => {
      mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
      (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_USER);
      const res = await callCheckout({ type: 'claw_platform' });
      expect(res.status).toBe(400);
    });
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
