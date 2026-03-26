import { describe, it, expect, vi } from 'vitest';
import { prismaMock } from '@/test/helpers/mock-prisma';

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/api/auth', () => ({ getSessionUser: () => mockGetSessionUser() }));

import { GET } from '@/app/api/user/billing/route';

describe('GET /api/user/billing', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 404 when user not found in DB', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-ghost' });
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('returns billing data with trial fields', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-1' });
    const trialEnd = new Date('2026-04-01T00:00:00Z');
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: false,
      subscriptionId: null,
      subscriptionEndsAt: null,
      trialUsed: true,
      trialStartedAt: new Date('2026-03-29T00:00:00Z'),
      trialEndsAt: trialEnd,
    });
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: 'RUNNING', currentMonthApiCost: 12.5 },
      { status: 'PAUSED', currentMonthApiCost: 3.2 },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.trialUsed).toBe(true);
    expect(json.data.trialEndsAt).toBe(trialEnd.toISOString());
    expect(json.data.hasActiveSubscription).toBe(false);
    expect(json.data.activeClaws).toBe(2);
    expect(json.data.runningClaws).toBe(1);
    expect(json.data.pausedClaws).toBe(1);
    expect(json.data.thisMonthTotal).toBeCloseTo(15.7, 1);
  });

  it('returns null trial fields when trial not started', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-new' });
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: false,
      subscriptionId: null,
      subscriptionEndsAt: null,
      trialUsed: false,
      trialStartedAt: null,
      trialEndsAt: null,
    });
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET();
    const json = await res.json();
    expect(json.data.trialUsed).toBe(false);
    expect(json.data.trialStartedAt).toBeNull();
    expect(json.data.trialEndsAt).toBeNull();
  });

  it('returns "Active" plan label when subscribed', async () => {
    mockGetSessionUser.mockResolvedValue({ id: 'user-sub' });
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: true,
      subscriptionId: 'sub-1',
      subscriptionEndsAt: new Date('2026-05-01'),
      trialUsed: true,
      trialStartedAt: new Date(),
      trialEndsAt: new Date(),
    });
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET();
    const json = await res.json();
    expect(json.data.plan).toBe('Active');
    expect(json.data.planPrice).toContain('$79');
    expect(json.data.nextBillingDate).toBeDefined();
  });
});
