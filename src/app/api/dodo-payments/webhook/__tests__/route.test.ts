import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';
import { NextRequest } from 'next/server';

process.env.DODO_PAYMENTS_API_KEY = 'test_key_placeholder';
process.env.DODO_PAYMENTS_WEBHOOK_KEY = 'test_webhook_key_placeholder';

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/dodo-payments', () => ({
  PLAN_LIMITS: {
    FREE: { maxWorkspaces: 1, maxAgentsPerWorkspace: 3, monthlyApiSpendLimit: 50, cloudHosting: false },
    PRO: { maxWorkspaces: 5, maxAgentsPerWorkspace: 10, monthlyApiSpendLimit: 200, cloudHosting: true },
    ENTERPRISE: { maxWorkspaces: 999, maxAgentsPerWorkspace: 50, monthlyApiSpendLimit: 10000, cloudHosting: true },
  },
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

describe('POST /api/dodo-payments/webhook', () => {
  describe('payment.succeeded', () => {
    it('creates workspace and purchase on claw_purchase', async () => {
      const template = {
        id: 'tpl-1',
        slug: 'quant-trader',
        name: 'Quant Trader',
        description: 'A trading bot',
        workspaceSnapshot: {
          agents: [
            { agentSlug: 'orch', name: 'Orchestrator', role: 'ORCHESTRATOR', model: 'HAIKU_4_5', soulMd: '', agentsMd: '', color: '#5BA1F5', positionX: 0, positionY: 0 },
            { agentSlug: 'critic', name: 'Critic', role: 'CRITIC', model: 'OPUS_4_6', soulMd: '', agentsMd: '', color: '#8b5cf6', positionX: 0, positionY: 200 },
          ],
          connections: [],
        },
      };

      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(template);
      (prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ws-new', name: 'Quant Trader' });
      (prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'agent-new' });
      (prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-1' });
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        event_type: 'payment.succeeded',
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
        event_type: 'payment.succeeded',
        data: {
          payment_id: 'pay_duplicate',
          metadata: { type: 'claw_purchase', userId: 'user-1', templateId: 'tpl-1' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.create).not.toHaveBeenCalled();
    });
  });

  describe('payment.failed', () => {
    it('records failed purchase', async () => {
      (prismaMock.purchase.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-fail' });

      const req = createWebhookRequest({
        event_type: 'payment.failed',
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
    it('pauses workspace on cloud hosting failure', async () => {
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        event_type: 'subscription.failed',
        data: {
          subscription_id: 'sub_fail',
          metadata: { type: 'cloud_hosting', workspaceId: 'ws-pause' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ws-pause' },
          data: { status: 'PAUSED' },
        })
      );
    });

    it('downgrades user to FREE on plan failure', async () => {
      (prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        event_type: 'subscription.failed',
        data: {
          subscription_id: 'sub_fail',
          metadata: { type: 'plan_upgrade', userId: 'user-downgrade' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-downgrade' },
          data: { subscriptionTier: 'FREE' },
        })
      );
    });
  });

  describe('subscription.cancelled', () => {
    it('updates purchase status to CANCELED', async () => {
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'purch-cancel' });
      (prismaMock.purchase.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        event_type: 'subscription.cancelled',
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
    it('marks purchase as REFUNDED and deletes recent workspace', async () => {
      const recentPurchase = {
        id: 'purch-refund',
        workspaceId: 'ws-refund',
        createdAt: new Date(),
      };
      (prismaMock.purchase.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(recentPurchase);
      (prismaMock.purchase.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
      (prismaMock.workspace.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = createWebhookRequest({
        event_type: 'refund.succeeded',
        data: { payment_id: 'pay_refund' },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prismaMock.purchase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REFUNDED' }),
        })
      );
      expect(prismaMock.workspace.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ws-refund' } })
      );
    });
  });

  it('returns 200 for unhandled event types', async () => {
    const req = createWebhookRequest({
      event_type: 'some.unknown.event',
      data: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
