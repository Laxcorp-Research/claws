import { test, expect } from '@playwright/test';
import { signInAsOnboardingUser } from './helpers/auth';

test.describe('Fresh-signup onboarding journey (blocking)', () => {
  test('incomplete user lands on /onboarding; My Claws stays gated', async ({ page }) => {
    await signInAsOnboardingUser(page, '/onboarding');

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: 'Welcome to Claws' })).toBeVisible();

    // Nav link exists but edge guard bounces incomplete users back.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Claws' }).click();
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('Create custom Claw → builder; DB flag true; exactly one My Claw 1', async ({ page }) => {
    await signInAsOnboardingUser(page, '/onboarding');

    // Wait until session hydrates (CTAs disabled while status===loading).
    await expect(page.getByRole('button', { name: 'Create custom Claw' })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Create custom Claw' }).click();
    await page.waitForURL(/\/builder\//, { timeout: 30_000 });
    expect(page.url()).toMatch(/\/builder\//);

    // Session cookie should now clear the gate for subsequent navigations.
    await page.goto('/my-claws');
    await page.waitForURL('**/my-claws', { timeout: 15_000 });
    expect(page.url()).toContain('/my-claws');

    // Use page.request so the session cookie from the browser context is sent.
    const res = await page.request.get('/api/workspaces');
    expect(res.ok()).toBe(true);
    const json = await res.json();
    const rows = (json.data ?? []) as Array<{ name: string; status: string }>;
    const myClaw1 = rows.filter((w) => w.name === 'My Claw 1');
    expect(myClaw1.length).toBe(1);
  });

  test('Skip onboarding → /my-claws', async ({ page }) => {
    await signInAsOnboardingUser(page, '/onboarding');

    await expect(page.getByRole('button', { name: /Skip onboarding/ })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Skip onboarding/ }).click();
    await page.waitForURL('**/my-claws', { timeout: 30_000 });
    expect(page.url()).toContain('/my-claws');
  });
});
