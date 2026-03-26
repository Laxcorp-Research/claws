import { describe, it, expect } from 'vitest';
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
});

describe('getTemplateProductId', () => {
  it('returns STANDARD product ID for $149', () => {
    const id = getTemplateProductId(149);
    expect(id).toBe(process.env.DODO_PRODUCT_TEMPLATE_149 || 'mock_template_149');
  });

  it('returns BUSINESS product ID for $199', () => {
    const id = getTemplateProductId(199);
    expect(id).toBe(process.env.DODO_PRODUCT_TEMPLATE_199 || 'mock_template_199');
  });

  it('returns PREMIUM product ID for $299', () => {
    const id = getTemplateProductId(299);
    expect(id).toBe(process.env.DODO_PRODUCT_TEMPLATE_299 || 'mock_template_299');
  });

  it('throws for unknown price', () => {
    expect(() => getTemplateProductId(999)).toThrow('Unknown template price: 999');
  });

  it('throws for zero price', () => {
    expect(() => getTemplateProductId(0)).toThrow('Unknown template price: 0');
  });
});
