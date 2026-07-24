import { test, expect } from '@playwright/test';
import { signInAsOnboardingUser, signInAsTestUser } from './helpers/auth';

test.describe('Getting started tracker (blocking)', () => {
  test('fresh flag-false user: grey tracker; step-3 snackbar; create → revisit S2 green → step-3 routes to setup', async ({
    page,
  }) => {
    await signInAsOnboardingUser(page, '/onboarding');

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();

    // Step 3 before any claw → snackbar + step-2 emphasis.
    await page.getByRole('button', { name: /Connect tools & deploy/ }).click();
    await expect(page.getByText(/Create a Claw first/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-emphasized="true"]')).toContainText('Pick your first Claw');

    // Create custom Claw → builder (idempotent create + completion from PR-1).
    await expect(page.getByRole('button', { name: 'Create custom Claw' })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Create custom Claw' }).click();
    await page.waitForURL(/\/builder\//, { timeout: 30_000 });

    // Revisit tracker — S2 green, step-3 continues into wizard (single workspace).
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: /Getting started|You're all set/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Claw created/)).toBeVisible();

    // Single DRAFT workspace → direct-route to builder (SETUP_INCOMPLETE → wizard).
    await page.getByRole('button', { name: /Continue setup/ }).click();
    await page.waitForURL(/\/builder\//, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/builder\//);
  });

  test('completed user: menu Getting started → revisit tracker (no redirect away)', async ({
    page,
  }) => {
    await signInAsTestUser(page);
    await page.goto('/my-claws');
    await page.waitForURL('**/my-claws', { timeout: 15_000 });

    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: /Getting started/ }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole('heading', { name: /Getting started|You're all set/ }),
    ).toBeVisible({ timeout: 15_000 });
    // Stay on tracker — not bounced to /my-claws.
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\/onboarding/);
    // Skip is gate-only.
    await expect(page.getByRole('button', { name: /Skip onboarding/ })).toHaveCount(0);
  });
});
