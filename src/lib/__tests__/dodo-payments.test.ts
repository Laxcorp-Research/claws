import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDeployEligibility, getTemplateProductId } from '@/lib/dodo-payments';

describe('checkDeployEligibility', () => {
  it('allows first deploy with trial', () => {
    const result = checkDeployEligibility({
      trialUsed: false,
      trialStartedAt: null,
      trialEndsAt: null,
      hasActiveSubscription: false,
    });
    expect(result).toEqual({
      canDeploy: true,
      reason: 'first_deploy_trial',
      needsSubscription: false,
      isFirstDeploy: true,
    });
  });

  it('allows deploy during active trial', () => {
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: new Date(),
      trialEndsAt: futureDate,
      hasActiveSubscription: false,
    });
    expect(result.canDeploy).toBe(true);
    expect(result.reason).toBe('trial_active');
    expect(result.needsSubscription).toBe(false);
    expect(result.isFirstDeploy).toBe(false);
  });

  it('allows deploy with active subscription after trial expires', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      trialEndsAt: pastDate,
      hasActiveSubscription: true,
    });
    expect(result.canDeploy).toBe(true);
    expect(result.reason).toBe('subscribed');
    expect(result.needsSubscription).toBe(false);
  });

  it('blocks deploy when trial expired and no subscription', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      trialEndsAt: pastDate,
      hasActiveSubscription: false,
    });
    expect(result.canDeploy).toBe(false);
    expect(result.reason).toBe('subscription_required');
    expect(result.needsSubscription).toBe(true);
    expect(result.isFirstDeploy).toBe(false);
  });

  it('blocks deploy when trialUsed but trialEndsAt is null (edge case)', () => {
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: null,
      trialEndsAt: null,
      hasActiveSubscription: false,
    });
    expect(result.canDeploy).toBe(false);
    expect(result.needsSubscription).toBe(true);
  });

  it('allows deploy with subscription even when trial never used', () => {
    const result = checkDeployEligibility({
      trialUsed: false,
      trialStartedAt: null,
      trialEndsAt: null,
      hasActiveSubscription: true,
    });
    expect(result.canDeploy).toBe(true);
    expect(result.isFirstDeploy).toBe(true);
  });

  it('on_hold is grace + update-card warning, never silent subscribed', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      trialEndsAt: pastDate,
      hasActiveSubscription: true,
      subscriptionStatus: "on_hold",
    });
    expect(result.canDeploy).toBe(true);
    expect(result.reason).toBe("subscription_on_hold");
    expect(result.warning).toBe("update_card");
    expect(result.needsSubscription).toBe(false);
    expect(result.reason).not.toBe("subscribed");
  });

  it("on_hold past 14 days denies deploy (cap)", () => {
    const result = checkDeployEligibility({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      hasActiveSubscription: true,
      subscriptionStatus: "on_hold",
      subscriptionOnHoldAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    });
    expect(result.canDeploy).toBe(false);
    expect(result.reason).toBe("on_hold_cap");
    expect(result.needsSubscription).toBe(true);
  });

  it('MUTATION: on_hold must be checked before hasActiveSubscription', () => {
    const src = readFileSync(join(process.cwd(), "src/lib/dodo-payments.ts"), "utf8");
    const hold = src.indexOf('isSubscriptionOnHold(user)');
    const subscribed = src.indexOf("reason: \"subscribed\"");
    expect(hold).toBeGreaterThan(0);
    expect(subscribed).toBeGreaterThan(hold);
  });

  it('MUTATION: eligibility selects must include subscriptionStatus', () => {
    const files = [
      'src/app/api/cron/health-monitor/route.ts',
      'src/app/api/cron/hibernation/route.ts',
      'src/lib/healing/silent-wake.ts',
      'src/lib/hibernation/manager.ts',
      'src/lib/railway/governor.ts',
      'src/lib/hibernation/wake-on-channel.ts',
      'src/app/api/workspaces/[id]/chat/route.ts',
      'src/app/api/deploy/[workspaceId]/cloud/route.ts',
      'src/app/api/dashboard/[workspaceId]/wake/route.ts',
      'src/app/api/deploy/[workspaceId]/restart/route.ts',
      'src/app/api/deploy/[workspaceId]/redeploy/route.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).toContain('subscriptionStatus: true');
      expect(src, rel).toContain('subscriptionOnHoldAt: true');
    }
  });
});

describe('getTemplateProductId', () => {
  it('returns TEMPLATE_49 product ID for $49', () => {
    const id = getTemplateProductId(49);
    expect(id).toBe(process.env.DODO_PRODUCT_TEMPLATE_49 || 'mock_template_49');
  });

  it('returns TEMPLATE_99 product ID for $99', () => {
    const id = getTemplateProductId(99);
    expect(id).toBe(process.env.DODO_PRODUCT_TEMPLATE_99 || 'mock_template_99');
  });

  it('throws for unknown price', () => {
    expect(() => getTemplateProductId(999)).toThrow('Unknown template price: 999');
  });

  it('throws for zero price (free templates bypass checkout)', () => {
    expect(() => getTemplateProductId(0)).toThrow('Unknown template price: 0');
  });
});

describe('createCommunityCheckout product_cart shape (PR-7)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/dodo-payments.ts'), 'utf8');

  it('product_cart uses dodoProductId - never Prisma cuid fields', () => {
    expect(src).toContain('product_cart: [{ product_id: params.productId, quantity: 1 }]');
    expect(src).not.toMatch(/product_cart:\s*\[\s*\{\s*product_id:\s*params\.templateId/);
    expect(src).toContain('COMMUNITY_CHECKOUT_REJECTS_CUID_AS_PRODUCT_ID');
  });

  it('MUTATION: cuid-as-product_id restored → this test fails', () => {
    expect(src).toMatch(/productId:\s*params\.dodoProductId/);
    expect(src).not.toMatch(/product_id:\s*params\.templateId/);
  });
});

describe('one-time checkout sessions allow discount codes', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/dodo-payments.ts'), 'utf8');

  it('ground-truth: checkoutSessions.create + feature_flags.allow_discount_code; no pre-applied code', () => {
    expect(src).toContain('dodo.checkoutSessions.create');
    expect(src).toContain('feature_flags: ONE_TIME_CHECKOUT_FLAGS');
    expect(src).toContain('allow_discount_code: true');
    expect(src).not.toMatch(/\bdiscount_code\s*:/);
    expect(src).not.toContain('dodo.payments.create');
  });

  it('subscription checkout does not enable coupons', () => {
    const start = src.indexOf('export async function createPlatformSubscription');
    const end = src.indexOf('export async function createCommunityCheckout');
    const subBlock = src.slice(start, end);
    expect(subBlock).toContain('feature_flags: EDITABLE_COUNTRY_FLAGS');
    expect(subBlock).not.toContain('allow_discount_code');
    expect(subBlock).not.toContain('dodo.subscriptions.create');
  });
});

describe('checkout session does not pre-fill country', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/dodo-payments.ts'), 'utf8');

  it('payload is email+name only - no billing_address / country / customer_id', () => {
    expect(src).toContain('email: params.userEmail');
    expect(src).toContain('name: params.userName || params.userEmail');
    expect(src).toContain('allow_customer_editing_country: true');
    expect(src).not.toMatch(/billing_address\s*:/)
    expect(src).not.toMatch(/customer_id\s*:/)
    expect(src).not.toMatch(/country:\s*"US"/);
    expect(src).not.toContain('dodo.subscriptions.create');
    expect(src).not.toContain('dodo.payments.create');
  });

  it('MUTATION: hardcoded US billing restored → fail', () => {
    expect(src).not.toMatch(/country:\s*["']US["']/);
    expect(src).not.toMatch(/billing:\s*\{\s*city:/);
  });
});

describe('ensureCommunityDodoProduct Phase A surface', () => {
  it('quotes products.create on the dodo community helper', () => {
    const helper = readFileSync(
      join(process.cwd(), 'src/lib/marketplace/dodo-community-product.ts'),
      'utf8',
    );
    expect(helper).toContain('dodo.products.create');
    expect(helper).toContain('one_time_price');
  });
});
