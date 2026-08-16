import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { NextRequest } from 'next/server';

process.env.DODO_PAYMENTS_API_KEY = 'test_key_placeholder';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'test_webhook_key_placeholder';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

const mockDestroyContainer = vi.fn();
vi.mock('@/lib/openclaw/deployer', () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}));

vi.mock('dodopayments', () => {
  const unwrapMock = vi.fn((body: string) => JSON.parse(body));
  return {
    default: class MockDodoPayments {
      webhooks = { unwrap: unwrapMock };
    },
    __unwrapMock: unwrapMock,
  };
});

import { POST } from '@/app/api/dodo-payments/webhook/route';

function createWebhookRequest(payload: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/dodo-payments/webhook'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': 'wh_test123',
      'webhook-signature': 'v1,sig_test',
      'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(payload),
  });
}

const MOCK_TEMPLATE = {
  id: 'tpl-1',
  slug: 'quant-trader',
  name: 'Quant Trader',
  description: 'A trading bot',
  price: 99,
  isFree: false,
  creatorId: null,
  workspaceSnapshot: JSON.stringify({
    agents: [
      { agentSlug: 'orch', name: 'Orchestrator', role: 'ORCHESTRATOR', model: 'HAIKU_4_5', soulMd: '', agentsMd: '', color: '#5BA1F5', positionX: 0, positionY: 0 },
      { agentSlug: 'critic', name: 'Critic', role: 'CRITIC', model: 'OPUS_4_6', soulMd: '', agentsMd: '', color: '#8b5cf6', positionX: 0, positionY: 200 },
    ],
    connections: [],
  }),
};

const MOCK_COMMUNITY_TEMPLATE = {
  ...MOCK_TEMPLATE,
  id: 'tpl-community',
  slug: 'community-claw',
  name: 'Community Claw',
  price: 49,
  creatorId: 'creator-1',
};

function setupTransactionMock() {
  (prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
}

function mockUserLookup(userId: string) {
  (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { where: { id?: string } }) => {
      if (args.where.id === userId) return Promise.resolve({ id: userId })
      return Promise.resolve(null)
    },
  );
}

function setupWorkspaceCreationMocks() {
  setupTransactionMock();
  (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
  (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-new', name: 'Quant Trader' });
  (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-new' });
  (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'install-1' });
  (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe('POST /api/dodo-payments/webhook', () => {
  describe('payment.succeeded', () => {
    it('creates workspace and purchase on claw_purchase', async () => {
      mockUserLookup('user-buyer');
      setupWorkspaceCreationMocks();
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-1' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_test_123',
          total_amount: 9900,
          currency: 'usd',
          customer: { customer_id: 'cust_123' },
          metadata: {
            type: 'claw_purchase',
            userId: 'user-buyer',
            templateId: 'tpl-1',
            templateSlug: 'quant-trader',
          },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.create).toHaveBeenCalled();
      expect(prismaMock.purchase.create).toHaveBeenCalled();
    });

    it('skips duplicate payment (idempotent)', async () => {
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'existing-purchase' });

      const req = createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_duplicate',
          metadata: { type: 'claw_purchase', userId: 'user-1', templateId: 'tpl-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.create).not.toHaveBeenCalled();
    });

    it('creates TemplateInstall and increments installCount on purchase', async () => {
      mockUserLookup('user-install');
      setupWorkspaceCreationMocks();
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-1' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_install_test',
          total_amount: 9900,
          currency: 'usd',
          customer: { customer_id: 'cust_456' },
          metadata: { type: 'claw_purchase', userId: 'user-install', templateId: 'tpl-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.templateInstall.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { templateId_userId: { templateId: 'tpl-1', userId: 'user-install' } },
        }),
      );
      expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tpl-1' },
          data: { installCount: { increment: 1 } },
        }),
      );
    });

    it('creates MarketplaceSale for community template purchase', async () => {
      mockUserLookup('user-buyer-c');
      setupTransactionMock();
      (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-community', name: 'Community Claw' });
      (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-c' });
      (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'install-c' });
      (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-c' });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-1' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_community_123',
          total_amount: 4900,
          currency: 'usd',
          customer: { customer_id: 'cust_789' },
          metadata: {
            type: 'community_purchase',
            userId: 'user-buyer-c',
            templateId: 'tpl-community',
            creatorId: 'creator-1',
          },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.marketplaceSale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateId: 'tpl-community',
            buyerId: 'user-buyer-c',
            creatorId: 'creator-1',
            amount: 49,
            payoutStatus: 'PENDING',
          }),
        }),
      );
      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.creatorPayout).toBeGreaterThan(0);
      expect(saleCall.data.processingFee).toBeGreaterThan(0);
      expect(saleCall.data.creatorPayout + saleCall.data.processingFee).toBeCloseTo(49, 1);
    });

    it('does not create MarketplaceSale for official template purchase', async () => {
      mockUserLookup('user-off');
      setupWorkspaceCreationMocks();
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TEMPLATE);
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-off' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_official_123',
          total_amount: 9900,
          currency: 'usd',
          customer: { customer_id: 'cust_off' },
          metadata: { type: 'claw_purchase', userId: 'user-off', templateId: 'tpl-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.marketplaceSale.create).not.toHaveBeenCalled();
    });

    it('community skill payment.succeeded mints MarketplaceSale (3.5% hold) + SkillInstall', async () => {
      mockUserLookup('user-skill');
      (prismaMock.marketplaceSale.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'skill-1',
        price: 29,
        creatorId: 'creator-1',
      });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-skill' });
      (prismaMock.skillInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'si-1' });
      (prismaMock.marketplaceSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await POST(createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_skill_1',
          total_amount: 2900,
          currency: 'usd',
          customer: { customer_id: 'cust_s' },
          metadata: {
            type: 'community_purchase',
            userId: 'user-skill',
            skillId: 'skill-1',
            creatorId: 'creator-1',
          },
        },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.marketplaceSale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            skillId: 'skill-1',
            amount: 29,
            processingFee: expect.closeTo(29 * 0.035, 2),
            payoutStatus: 'PENDING',
            dodoPaymentId: 'pay_skill_1',
          }),
        }),
      );
      expect(prismaMock.skillInstall.upsert).toHaveBeenCalled();
      expect(prismaMock.purchase.create).not.toHaveBeenCalled();
    });

    it('MarketplaceSale uses webhook total_amount (paid), not list price', async () => {
      mockUserLookup('user-buyer-c');
      setupTransactionMock();
      (prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-community', name: 'Community Claw' });
      (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-c' });
      (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'install-c' });
      (prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_COMMUNITY_TEMPLATE);
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-c' });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-disc' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await POST(createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_discounted',
          total_amount: 2000,
          currency: 'usd',
          customer: { customer_id: 'cust_disc' },
          metadata: {
            type: 'community_purchase',
            userId: 'user-buyer-c',
            templateId: 'tpl-community',
            creatorId: 'creator-1',
          },
        },
      }));
      expect(res.status).toBe(200);
      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.amount).toBe(20);
      expect(saleCall.data.processingFee).toBeCloseTo(0.7, 2);
      expect(saleCall.data.creatorPayout).toBeCloseTo(19.3, 2);
      expect(saleCall.data.amount).not.toBe(MOCK_COMMUNITY_TEMPLATE.price);
      const purchCall = (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(purchCall.data.amountPaid).toBe(20);
    });

    it('community skill sale uses paid total_amount when discounted', async () => {
      mockUserLookup('user-skill');
      (prismaMock.marketplaceSale.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'skill-1',
        price: 29,
        creatorId: 'creator-1',
      });
      (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sale-skill-d' });
      (prismaMock.skillInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'si-1' });
      (prismaMock.marketplaceSkill.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await POST(createWebhookRequest({
        type: 'payment.succeeded',
        data: {
          payment_id: 'pay_skill_disc',
          total_amount: 1000,
          currency: 'usd',
          customer: { customer_id: 'cust_s' },
          metadata: {
            type: 'community_purchase',
            userId: 'user-skill',
            skillId: 'skill-1',
            creatorId: 'creator-1',
          },
        },
      }));
      expect(res.status).toBe(200);
      const saleCall = (prismaMock.marketplaceSale.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(saleCall.data.amount).toBe(10);
      expect(saleCall.data.processingFee).toBeCloseTo(0.35, 2);
      expect(saleCall.data.creatorPayout).toBeCloseTo(9.65, 2);
      expect(saleCall.data.amount).not.toBe(29);
    });
  });

  describe('payment.failed', () => {
    it('records failed purchase', async () => {
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-fail' });

      const req = createWebhookRequest({
        type: 'payment.failed',
        data: {
          payment_id: 'pay_fail_123',
          metadata: { type: 'claw_purchase', userId: 'user-1', templateId: 'tpl-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.purchase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        })
      );
    });
  });

  describe('subscription.failed', () => {
    beforeEach(() => {
      mockDestroyContainer.mockReset();
      mockDestroyContainer.mockResolvedValue(undefined);
    });

    it('destroys workspace container on platform subscription failure', async () => {
      mockUserLookup('user-downgrade');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.failed',
        data: {
          subscription_id: 'sub_fail',
          metadata: { type: 'claw_platform', workspaceId: 'ws-pause', userId: 'user-downgrade' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockDestroyContainer).toHaveBeenCalledWith('ws-pause');
    });

    it('still returns 200 when destroyContainer throws (avoid Dodo retry storm)', async () => {
      mockUserLookup('user-downgrade');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      mockDestroyContainer.mockRejectedValueOnce(new Error('Railway API 500'));

      const req = createWebhookRequest({
        type: 'subscription.failed',
        data: {
          subscription_id: 'sub_fail',
          metadata: { type: 'claw_platform', workspaceId: 'ws-pause', userId: 'user-downgrade' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockDestroyContainer).toHaveBeenCalledWith('ws-pause');
    });

    it('deactivates subscription on failure', async () => {
      mockUserLookup('user-downgrade');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.failed',
        data: {
          subscription_id: 'sub_fail',
          metadata: { type: 'claw_platform', userId: 'user-downgrade' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-downgrade' },
          data: { hasActiveSubscription: false, subscriptionStatus: 'failed' },
        })
      );
    });
  });

  describe('subscription.on_hold', () => {
    it('keeps hasActiveSubscription true and stamps subscriptionStatus=on_hold', async () => {
      mockUserLookup('user-dunning');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.on_hold',
        data: {
          subscription_id: 'sub_hold',
          metadata: { type: 'claw_platform', userId: 'user-dunning' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-dunning' },
          data: expect.objectContaining({
            hasActiveSubscription: true,
            subscriptionStatus: 'on_hold',
            subscriptionId: 'sub_hold',
          }),
        }),
      );
    });
  });

  describe('subscription lifecycle ledger', () => {
    it('writes AuditLog on subscription.active naming the event', async () => {
      mockUserLookup('user-ledger');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user-ledger',
        hasActiveSubscription: true,
        subscriptionId: 'sub_ledger',
      });
      (prismaMock.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.active',
        data: {
          subscription_id: 'sub_ledger',
          customer: { customer_id: 'cust_ledger' },
          metadata: { type: 'claw_platform', userId: 'user-ledger', workspaceId: 'ws-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-ledger',
            workspaceId: 'ws-1',
            action: 'SUBSCRIPTION_STARTED',
            resource: 'subscription.active',
            resourceId: 'sub_ledger',
          }),
        }),
      );
      const after = JSON.parse(
        (prismaMock.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.after as string,
      ) as { eventType: string; subscriptionStatus: string }
      expect(after).toMatchObject({ eventType: 'subscription.active', subscriptionStatus: 'active' })
    });

    it('writes AuditLog on subscription.cancelled', async () => {
      mockUserLookup('user-cancel');
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.cancelled',
        data: {
          subscription_id: 'sub_cancel_ledger',
          metadata: { type: 'claw_platform', userId: 'user-cancel' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SUBSCRIPTION_CANCELED',
            resource: 'subscription.cancelled',
          }),
        }),
      );
    });
  });

  describe('subscription.cancelled', () => {
    it('updates purchase status to CANCELED', async () => {
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-cancel' });
      (prismaMock.purchase.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        type: 'subscription.cancelled',
        data: {
          subscription_id: 'sub_cancel',
          metadata: { type: 'claw_purchase' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { subscriptionStatus: 'CANCELED' },
        })
      );
    });
  });

  describe('refund.succeeded', () => {
    function stubRefundPurchase(overrides: {
      createdAt: Date
      workspaceId?: string | null
      hasDeploy?: boolean
    }) {
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'purch-refund',
        userId: 'user-1',
        workspaceId: overrides.workspaceId === undefined ? 'ws-refund' : overrides.workspaceId,
        createdAt: overrides.createdAt,
        dodoPaymentId: 'pay_refund',
      });
      (prismaMock.marketplaceSale.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sale-refund',
        skillId: null,
        buyerId: 'user-1',
        payoutStatus: 'PENDING',
        amount: 49,
        creatorPayout: 47,
        templateId: 'tpl-1',
        creatorId: 'creator-1',
        dodoPaymentId: 'pay_refund',
      });
      (prismaMock.purchase.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.marketplaceSale.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.marketplaceSale.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      (prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        overrides.hasDeploy ? { id: 'dep-1' } : null,
      );
      (prismaMock.workspace.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1' });
    }

    it('early × never-deployed: REFUNDED + delete workspace + cancelPayout', async () => {
      stubRefundPurchase({ createdAt: new Date(), hasDeploy: false });

      const res = await POST(createWebhookRequest({
        type: 'refund.succeeded',
        data: { payment_id: 'pay_refund' },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFUNDED' }),
        }),
      );
      // cancelPayout uses update (by sale id), not updateMany — status-aware clawback.
      expect(prismaMock.marketplaceSale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sale-refund' },
          data: expect.objectContaining({ payoutStatus: 'REFUNDED' }),
        }),
      );
      expect(prismaMock.workspace.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ws-refund' } }),
      );
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('early × deployed: REFUNDED + retain workspace + ledger note', async () => {
      stubRefundPurchase({ createdAt: new Date(), hasDeploy: true });

      const res = await POST(createWebhookRequest({
        type: 'refund.succeeded',
        data: { payment_id: 'pay_refund' },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.delete).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resource: 'refund.succeeded.workspace_retained',
          }),
        }),
      );
    });

    it('late × never-deployed: REFUNDED + retain workspace', async () => {
      stubRefundPurchase({
        createdAt: new Date(Date.now() - 10 * 86_400_000),
        hasDeploy: false,
      });

      const res = await POST(createWebhookRequest({
        type: 'refund.succeeded',
        data: { payment_id: 'pay_refund' },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.delete).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });

    it('late × deployed: REFUNDED + retain workspace', async () => {
      stubRefundPurchase({
        createdAt: new Date(Date.now() - 10 * 86_400_000),
        hasDeploy: true,
      });

      const res = await POST(createWebhookRequest({
        type: 'refund.succeeded',
        data: { payment_id: 'pay_refund' },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.delete).not.toHaveBeenCalled();
      expect(prismaMock.marketplaceSale.update).toHaveBeenCalled();
    });

    it('community skill sale clawback: cancelPayout without Purchase row', async () => {
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.marketplaceSale.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'sale-skill-r',
        skillId: 'skill-1',
        buyerId: 'user-1',
        payoutStatus: 'RELEASABLE',
        amount: 19,
        creatorPayout: 18,
        templateId: null,
        creatorId: 'creator-1',
        dodoPaymentId: 'pay_skill_refund',
      });
      (prismaMock.marketplaceSale.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await POST(createWebhookRequest({
        type: 'refund.succeeded',
        data: { payment_id: 'pay_skill_refund' },
      }));
      expect(res.status).toBe(200);
      expect(prismaMock.marketplaceSale.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sale-skill-r' },
          data: expect.objectContaining({ payoutStatus: 'REFUNDED' }),
        }),
      );
      expect(prismaMock.purchase.update).not.toHaveBeenCalled();
      expect(prismaMock.workspace.delete).not.toHaveBeenCalled();
    });
  });

  it('returns 200 for unhandled event types', async () => {
    const req = createWebhookRequest({
      type: 'some.unknown.event',
      data: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
