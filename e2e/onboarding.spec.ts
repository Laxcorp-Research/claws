import { test, expect } from '@playwright/test';
import { signInAsOnboardingUser, signInAsTestUser } from './helpers/auth';

test.describe('Getting started tracker v2.1 (blocking)', () => {
  test('fresh user with starter credits: S1 green-via-credits; step-3 picker → wizard row', async ({
    page,
  }) => {
    // test-session (onboardingCompleted=false) seeds CreditAccount $50 — see route.ts.
    await signInAsOnboardingUser(page, '/onboarding');

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    await expect(page.getByText(/Powered by Claws Starter Credits/)).toBeVisible({
      timeout: 15_000,
    });

    // Create a claw so S2 is done, then revisit.
    await expect(page.getByRole('button', { name: 'Create custom Claw' })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Create custom Claw' }).click();
    await page.waitForURL(/\/builder\//, { timeout: 30_000 });

    await page.goto('/onboarding');
    await expect(page.getByText(/Claw created/)).toBeVisible({ timeout: 15_000 });

    // Step 3: even with one claw, picker expands.
    await page.getByRole('button', { name: /Set up & deploy/ }).click();
    await expect(page.getByText('Choose a Claw to set up')).toBeVisible();
    await page.getByRole('button', { name: /My Claw 1/ }).click();
    // DRAFT → builder per status routing.
    await page.waitForURL(/\/builder\//, { timeout: 15_000 });
  });

  test('all-green account: nav Getting started absent; user-menu entry present', async ({
    page,
  }) => {
    // Completed e2e-test user — assume not all-green; we only assert menu always
    // and that when API reports all-green the nav hides. For a stable all-green
    // check, stub the onboarding state endpoint.
    await signInAsTestUser(page);
    await page.goto('/my-claws');
    await page.waitForURL('**/my-claws', { timeout: 15_000 });

    await page.route('**/api/onboarding/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { s1: true, s2: true, s3: true } }),
      });
    });
    await page.reload();
    await page.waitForURL('**/my-claws', { timeout: 15_000 });

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Getting started' })).toHaveCount(0);

    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByRole('menuitem', { name: /Getting started/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /Getting started/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);
  });
});
