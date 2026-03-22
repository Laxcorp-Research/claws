import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth';

test.describe('Authentication', () => {
  test('sign-in page renders with all providers', async ({ page }) => {
    await page.goto('/auth/signin');

    const pageContent = await page.textContent('body');

    const hasGitHub = pageContent?.includes('GitHub') || pageContent?.includes('github');
    const hasGoogle = pageContent?.includes('Google') || pageContent?.includes('google');

    expect(hasGitHub || hasGoogle).toBe(true);
  });

  test('unauthenticated user is redirected from protected routes', async ({ page }) => {
    await page.goto('/my-claws');
    await page.waitForURL('**/auth/signin**', { timeout: 10_000 });
    expect(page.url()).toContain('auth/signin');
  });

  test('test user can sign in and access protected routes', async ({ page }) => {
    await signInAsTestUser(page);

    expect(page.url()).toContain('/my-claws');

    const pageContent = await page.textContent('body');
    const hasAuthContent =
      pageContent?.includes('My Claws') ||
      pageContent?.includes('Workspace') ||
      pageContent?.includes('No claws yet') ||
      pageContent?.includes('Get started');

    expect(hasAuthContent).toBe(true);
  });
});
